/**
 * The E2E pre-flight guard — the third endpoint, checked before anything starts.
 *
 * `tests/support/stack.ts` proves the connection *this process* opens is
 * loopback, and `assertBaseUrlIsLocal` proves the `baseURL` the *browser* is
 * pointed at is loopback. Neither says where the Nuxt server the browser drives
 * sends its own writes. That server reads `NUXT_PUBLIC_SUPABASE_URL` from its
 * own environment (`shared/supabase/config.ts`), so a developer whose `.env`
 * names their hosted project could get `bun run test:e2e` driving a real
 * sign-up into `auth.users` on production, with every other guard in the repo
 * green — issue #57.
 *
 * `assertAppTargetsLocalStack` in `tests/e2e/fixtures.ts` already closes that
 * from inside the browser, and it stays as defence-in-depth for a server that
 * changes its target under a long-lived run. But it only fires after a build, a
 * server boot, a browser launch and a hydrated navigation, and not at all for a
 * bare `page.goto`. This runs first, before Playwright starts or attaches to
 * anything, so a production-configured run fails immediately with the host in
 * the message and never reaches a browser.
 *
 * It answers the same question two ways, because there are two ways an E2E run
 * gets a server:
 *
 *  - A server is already listening on the base URL. `reuseExistingServer` is on
 *    outside CI, so Playwright will attach to it and `webServer.env` injection
 *    does nothing. The server itself is then the authoritative answer: probe it
 *    over plain HTTP and read the Supabase URL it inlined into its own SSR
 *    markup. If the probe cannot get a clean answer, fail closed — a guard that
 *    cannot read its subject must not pass, and guessing here is the exact
 *    failure mode this issue is about.
 *  - Nothing is listening. Playwright will start the server, so resolve what it
 *    will be handed: the local stack `playwright.config.ts` injects via
 *    `webServer.env` when one is up, otherwise the `NUXT_PUBLIC_SUPABASE_URL`
 *    the server would read from the environment or `.env`.
 *
 * No environment variable turns any of this off. The one network call in the
 * whole guard is the probe below; the rule and the resolution are pure pieces
 * from `tests/support/stack.ts`.
 *
 * On Playwright's `globalSetup`-vs-`webServer` ordering: it has moved between
 * versions and this file does not depend on it. Both a not-yet-started server
 * and an already-running one are handled, so whichever runs first is fine.
 */

import type { FullConfig } from '@playwright/test'
import {
  assertLocalUrl,
  extractAppSupabaseUrl,
  resolveConfiguredAppSupabaseUrl,
  resolveStack,
} from '../support/stack'

/** The default `webServer.url` / `baseURL` when `RUNWAY_E2E_BASE_URL` is unset. */
const DEFAULT_BASE_URL = 'http://127.0.0.1:3000'

/**
 * Whether a failed `fetch` failed because nothing is listening.
 *
 * Node's `fetch` wraps the underlying socket error in `err.cause`; a loopback
 * host with no server yields `ECONNREFUSED` there, or inside an `AggregateError`
 * when the runtime tried more than one address. Only that specific code counts
 * as "no server" — every other failure means a server answered badly, which is
 * the fail-closed case, not the start-one case.
 */
function isConnectionRefused(err: unknown): boolean {
  const cause = (err as { cause?: unknown }).cause
  if (!cause || typeof cause !== 'object') return false
  if ((cause as { code?: unknown }).code === 'ECONNREFUSED') return true
  const nested = (cause as { errors?: unknown }).errors
  return (
    Array.isArray(nested) &&
    nested.some((entry) => (entry as { code?: unknown })?.code === 'ECONNREFUSED')
  )
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  // 1. The browser's target. `assertBaseUrlIsLocal` in fixtures.ts makes this
  //    same check, but only once a spec file has loaded; making it here moves
  //    it ahead of the server boot as a side effect. `config.projects[0].use`
  //    carries the merged `use`, and the fallback matches `playwright.config.ts`'s
  //    own default so a run with no custom base URL still resolves correctly.
  const baseUrl = config.projects[0]?.use?.baseURL ?? DEFAULT_BASE_URL
  assertLocalUrl(baseUrl, 'its base URL', 'the E2E base URL (RUNWAY_E2E_BASE_URL)')

  // 2. Is a server already up on that URL? If so it is authoritative — Playwright
  //    will reuse it and injection into a server this config did not start does
  //    nothing — so read where it actually points rather than reasoning about it.
  let probe: Response | undefined
  try {
    probe = await fetch(new URL('/sign-in', baseUrl), {
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
    })
  } catch (err) {
    if (!isConnectionRefused(err)) {
      throw new Error(
        'Refusing to run E2E: a server is listening on the E2E base URL but the pre-flight ' +
          'probe of it failed, so this run cannot establish which Supabase project that server ' +
          'is configured against. A guard that cannot read its subject must not pass. ' +
          `(probe failure: ${(err as { cause?: { code?: string } }).cause?.code ?? (err as Error).name})`,
      )
    }
    // ECONNREFUSED — nothing is listening. Playwright will start the server; fall
    // through to resolving what it will be handed.
  }

  if (probe) {
    if (!probe.ok) {
      throw new Error(
        'Refusing to run E2E: the server already listening on the E2E base URL answered the ' +
          `pre-flight probe with HTTP ${probe.status}, so this run cannot establish which ` +
          'Supabase project it is configured against. A guard that cannot read its subject ' +
          'must not pass.',
      )
    }
    const configuredUrl = extractAppSupabaseUrl(await probe.text())
    if (!configuredUrl) {
      throw new Error(
        'Refusing to run E2E: the server already listening on the E2E base URL did not expose ' +
          'a Supabase URL in its server-rendered markup, so this run cannot establish which ' +
          'project it is configured against. A guard that cannot read its subject must not pass.',
      )
    }
    assertLocalUrl(
      configuredUrl,
      'its Supabase URL',
      'the server already listening on the E2E base URL, which this run will reuse rather than start',
    )
    return
  }

  // 3. No server yet. Resolve what the one Playwright starts will receive.
  //    `playwright.config.ts` injects `resolveStack().apiUrl` via `webServer.env`,
  //    which wins over `.env` — loopback by construction, asserted anyway for the
  //    same reason `resolveStack` asserts `supabase status`: the value of a guard
  //    is that it holds for the case nobody predicted.
  const stack = resolveStack()
  if (stack) {
    assertLocalUrl(
      stack.apiUrl,
      'its Supabase URL',
      'the local stack that playwright.config.ts injects into the E2E server via webServer.env',
    )
    return
  }

  // No stack, so no injection: the server will read `NUXT_PUBLIC_SUPABASE_URL`
  // from the environment or `.env`, exactly as `bun run preview` would. A `null`
  // here is also a failure — a server with no Supabase URL cannot render a single
  // page (`shared/supabase/config.ts`), and failing now says why.
  const configured = resolveConfiguredAppSupabaseUrl()
  if (!configured) {
    throw new Error(
      'Refusing to run E2E: no local Supabase stack is running and NUXT_PUBLIC_SUPABASE_URL is ' +
        'set nowhere — not in the environment, not in .env — so the server this run starts ' +
        'could not render a page to test. Start the stack with `bun run db:start`.',
    )
  }
  assertLocalUrl(
    configured.url,
    'its Supabase URL',
    `the app under test (from ${configured.source})`,
  )
}
