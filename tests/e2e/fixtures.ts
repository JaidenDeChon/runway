/**
 * The E2E harness's fixtures — chiefly the authenticated-session one.
 *
 * ## What changed when issue #6 landed
 *
 * This file used to hand the browser a session in `localStorage`, because that
 * is where `@supabase/supabase-js`'s plain `createClient` puts one, and because
 * the app read nothing at the time. Authentication moved the session into
 * **cookies**: `@supabase/ssr` keeps it there so a server-rendered request can
 * see it, which is the whole basis of route protection and of `requireUser()`
 * in a Nitro handler. A `localStorage` session would now be invisible to the
 * server, and every protected page would redirect to sign-in.
 *
 * So the fixture installs cookies. The trick that made the old version
 * trustworthy is the one that makes this version trustworthy too, applied to a
 * different store: rather than guessing the cookie name, the chunking rule or
 * the encoding, it hands a **real `@supabase/ssr` server client** a cookie
 * adapter that records what the library writes, signs in for real, and installs
 * exactly those name/value pairs. The library is the authority on its own
 * format, and it has changed that format between minor versions before.
 *
 * ## What the fixture still proves before any test uses it
 *
 * The minted token is used to read the seeded user's rows through PostgREST
 * *before* it reaches the browser, so a dead token fails here, loudly, rather
 * than as a confusing redirect three tests later.
 *
 * ## The stack is no longer optional
 *
 * Every screen in the app is behind sign-in now, so every E2E spec needs a
 * session, so every E2E spec needs the local stack. That is a real cost and it
 * is the honest one: a suite that drove the app without signing in would be
 * driving an app that no longer exists. `requireStackOrSkip` still skips
 * locally for somebody with no Docker, and still refuses to skip in CI.
 */

import { test as base, expect } from '@playwright/test'
import { createServerClient } from '@supabase/ssr'
import { adminSql, LOCAL_STACK, type SeedUser, USER_A, USER_C, USER_D } from '../support/database'
import { assertLocalOnly, assertLocalUrl, hostOf, isLoopbackHost } from '../support/stack'

export { expect }

/** One cookie exactly as `@supabase/ssr` chose to write it. */
export interface SessionCookie {
  readonly name: string
  readonly value: string
}

export interface BrowserSession {
  /** The cookies `@supabase/ssr` itself wrote for this project URL. */
  readonly cookies: readonly SessionCookie[]
  readonly accessToken: string
  readonly userId: string
  readonly email: string
}

/**
 * Signs in for real and captures the cookies the library persists.
 *
 * The capturing adapter is the whole trick: it makes `@supabase/ssr` disclose
 * the exact names and values the app will later look for, instead of this file
 * asserting a format it does not own. A large session is chunked across
 * `…auth-token.0`, `…auth-token.1`, …; capturing rather than reconstructing
 * means that is handled without this file knowing it happens.
 */
export async function mintBrowserSession(user: SeedUser): Promise<BrowserSession> {
  if (!LOCAL_STACK) throw new Error('mintBrowserSession requires the local Supabase stack')

  const jar = new Map<string, string>()

  const client = createServerClient(LOCAL_STACK.apiUrl, LOCAL_STACK.anonKey, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) {
          if (value) jar.set(name, value)
          else jar.delete(name)
        }
      },
    },
  })

  const { data, error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  })
  if (error || !data.session) {
    throw new Error(`could not sign in as ${user.email}: ${error?.message ?? 'no session'}`)
  }

  const cookies = [...jar.entries()]
    .filter(([name]) => name.startsWith('sb-'))
    .map(([name, value]) => ({ name, value }))

  if (cookies.length === 0) {
    throw new Error(
      '@supabase/ssr persisted no sb-* cookie, so this fixture cannot know what the app will ' +
        'read. Check the client options in tests/e2e/fixtures.ts against the installed ' +
        '@supabase/ssr version.',
    )
  }

  return {
    cookies,
    accessToken: data.session.access_token,
    userId: data.user?.id ?? '',
    email: user.email,
  }
}

/**
 * Proves a minted token actually authenticates, before any test relies on it.
 *
 * Without this the fixture could hand the browser a dead token and the failure
 * would surface as "the dashboard redirected to sign-in", which reads as an
 * application bug rather than as a broken fixture.
 */
export async function assertSessionAuthenticates(session: BrowserSession): Promise<number> {
  if (!LOCAL_STACK) throw new Error('assertSessionAuthenticates requires the local Supabase stack')

  const response = await fetch(
    `${LOCAL_STACK.apiUrl.replace(/\/$/, '')}/rest/v1/accounts?select=id,user_id`,
    {
      headers: {
        apikey: LOCAL_STACK.anonKey,
        Authorization: `Bearer ${session.accessToken}`,
        Accept: 'application/json',
      },
    },
  )
  if (response.status !== 200) {
    throw new Error(`the minted session was refused by PostgREST: HTTP ${response.status}`)
  }
  const rows = (await response.json()) as { id: string; user_id: string }[]
  const foreign = rows.filter((row) => row.user_id !== session.userId)
  if (foreign.length > 0) {
    throw new Error(`RLS BREACH: the minted session can see ${foreign.length} foreign row(s)`)
  }
  return rows.length
}

/**
 * Wipes user D's household back to empty, over the admin connection.
 *
 * User D (issue #7) is the E2E suite's write target for account creation:
 * every route now writes real rows, and running those specs as user A would
 * accumulate accounts that break `tests/rls/seed-fidelity.test.ts`'s
 * exact-list assertion. The admin connection is the correct choice for the
 * same reason `tests/support/fixtures.ts`'s `removeFixtures` gives — teardown
 * must succeed even when the write path under test is broken, so it cannot be
 * blockable by that same mechanism.
 *
 * Deleting `accounts` cascades to `recurring_rules`, `occurrences`,
 * `transfers` and now `dashboard_hidden_accounts` (`docs/database/schema.md`),
 * so the account delete alone is enough to clear everything the E2E suite
 * could have written for D — no explicit `dashboard_hidden_accounts` delete is
 * needed. `user_settings` is reset alongside it in case a test ever sets the
 * discretionary designation, the staleness threshold, or (issue #12) the
 * dashboard's stored horizon.
 */
export async function resetEmptyHousehold(): Promise<void> {
  const sql = adminSql()
  try {
    await sql`delete from public.accounts where user_id = ${USER_D.id}`
    await sql`
      update public.user_settings
      set discretionary_account_id = null, balance_stale_after_days = 14, default_horizon_days = 30
      where user_id = ${USER_D.id}
    `
  } finally {
    await sql.end()
  }
}

/**
 * Clears user A's persisted chart-account selection, over the admin connection.
 *
 * Issue #12 made hiding a chart account a write to `dashboard_hidden_accounts`,
 * not page-local state. `dashboard.spec.ts`'s "renders one segment pair per
 * line" test toggles A's Savings checkbox off to prove the segment count
 * reacts — same as `default_horizon_days` above, that click now durably
 * changes A's row, and unlike the horizon test this one cannot simply move to
 * user D: it needs A's two real seeded accounts, not an empty household. So
 * the fixture resets A's hidden set instead, before and after, the same
 * belt-and-braces the horizon test gets from running on D.
 */
export async function resetUserAChartSelection(): Promise<void> {
  const sql = adminSql()
  try {
    await sql`delete from public.dashboard_hidden_accounts where user_id = ${USER_A.id}`
  } finally {
    await sql.end()
  }
}

/**
 * Skip locally when there is no stack; refuse to skip where skipping would lie.
 *
 * Without the second half, a CI run in which `supabase start` came up broken
 * would silently skip every authenticated test and report the E2E job green —
 * the same "a skipped suite is indistinguishable from a passing one" trap the
 * integration project guards against with the very same variable. The E2E job
 * sets `RUNWAY_RLS_REQUIRE_STACK=1` for exactly this reason.
 */
export function requireStackOrSkip(): void {
  if (LOCAL_STACK) return
  if (process.env.RUNWAY_RLS_REQUIRE_STACK === '1') {
    throw new Error(
      'RUNWAY_RLS_REQUIRE_STACK=1 but the local Supabase stack is not reachable. ' +
        'Refusing to skip the authenticated E2E tests: skipping them here would report a ' +
        'green run for a session nothing has checked.',
    )
  }
  test.skip(true, 'needs the local Supabase stack — `bun run db:start`')
}

interface RunwayFixtures {
  /** A page that already holds a verified session for the seeded user A. */
  authenticatedPage: import('@playwright/test').Page
  session: BrowserSession
  /**
   * A verified session for user D, the empty household — every write-flow
   * spec's target. Wipes D's household before *and* after the test runs, so a
   * crashed run leaves debris the next one sweeps rather than debris that
   * accumulates. Safe only because `playwright.config.ts` pins `workers: 1`:
   * a second worker resetting the same shared household mid-test would race
   * this one.
   */
  emptyHouseholdSession: BrowserSession
  /** A page that already holds a verified session for user D. */
  emptyHouseholdPage: import('@playwright/test').Page
  /**
   * A verified session for user C — the short household `domain/seed.test.ts`
   * proves is short at every horizon the dashboard offers, on every day for
   * over a year (see the file's own doc comment). **Read-only**: unlike D,
   * this fixture resets nothing before or after, because
   * `tests/rls/seed-fidelity.test.ts` holds C to `domain/seed.ts` exactly — a
   * test using this fixture must not write through it.
   */
  shortHouseholdSession: BrowserSession
  /** A page that already holds a verified session for user C. Read-only — see above. */
  shortHouseholdPage: import('@playwright/test').Page
}

export const test = base.extend<RunwayFixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright's fixture signature requires the destructured first argument even when nothing is taken from it.
  session: async ({}, use) => {
    requireStackOrSkip()
    const session = await mintBrowserSession(USER_A)
    await assertSessionAuthenticates(session)
    await use(session)
  },

  authenticatedPage: async ({ page, context, baseURL, session }, use) => {
    // Installed on the context before the first navigation, so the very first
    // *server* render already sees the session — which is the point of cookies
    // over `localStorage`, and what stops a protected page redirecting once
    // before settling.
    await context.addCookies(
      session.cookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        url: baseURL ?? 'http://127.0.0.1:3000',
      })),
    )
    await use(page)
  },

  // biome-ignore lint/correctness/noEmptyPattern: Playwright's fixture signature requires the destructured first argument even when nothing is taken from it.
  emptyHouseholdSession: async ({}, use) => {
    requireStackOrSkip()
    await resetEmptyHousehold()
    const session = await mintBrowserSession(USER_D)
    // Not asserted `> 0`: D's whole point is having nothing. This still
    // proves the token authenticates and RLS scopes it, exactly as it does
    // for user A — `assertSessionAuthenticates` already returns the count
    // rather than asserting on it, for this reason.
    await assertSessionAuthenticates(session)
    await use(session)
    await resetEmptyHousehold()
  },

  emptyHouseholdPage: async ({ page, context, baseURL, emptyHouseholdSession }, use) => {
    await context.addCookies(
      emptyHouseholdSession.cookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        url: baseURL ?? 'http://127.0.0.1:3000',
      })),
    )
    await use(page)
  },

  // biome-ignore lint/correctness/noEmptyPattern: Playwright's fixture signature requires the destructured first argument even when nothing is taken from it.
  shortHouseholdSession: async ({}, use) => {
    requireStackOrSkip()
    const session = await mintBrowserSession(USER_C)
    await assertSessionAuthenticates(session)
    await use(session)
    // No reset: this household is never written to, so there is nothing to
    // put back.
  },

  shortHouseholdPage: async ({ page, context, baseURL, shortHouseholdSession }, use) => {
    await context.addCookies(
      shortHouseholdSession.cookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        url: baseURL ?? 'http://127.0.0.1:3000',
      })),
    )
    await use(page)
  },
})

/**
 * Pages already checked, so the guard costs one `evaluate` per test rather
 * than one per navigation. Keyed on the `Page` object, so it cannot leak
 * between tests.
 */
const targetChecked = new WeakSet<import('@playwright/test').Page>()

/**
 * The Supabase project the **running app** is configured against.
 *
 * Read from the app's own runtime config rather than from this process's
 * environment, because those are not the same thing and the difference is the
 * entire point — see `assertAppTargetsLocalStack`.
 *
 * Throws when it cannot read the value. That is not defensiveness for its own
 * sake: a guard that silently passes when its probe stops working is worse
 * than no guard, because it is *believed*. `tests/e2e/local-only.spec.ts`
 * asserts the probe returns the real value, so this failing closed is a
 * backstop and not the only defence.
 */
export async function readAppSupabaseTarget(
  page: import('@playwright/test').Page,
): Promise<string> {
  const url = await page.evaluate(() => {
    const nuxt = (globalThis as { useNuxtApp?: () => { $config?: unknown } }).useNuxtApp
    if (typeof nuxt !== 'function') return null
    const config = nuxt().$config as { public?: { supabase?: { url?: unknown } } } | undefined
    const value = config?.public?.supabase?.url
    return typeof value === 'string' ? value : null
  })

  if (!url) {
    throw new Error(
      "Refusing to run: could not read the running app's Supabase URL from its runtime " +
        'config, so there is no way to prove it is not pointed at the hosted project. ' +
        'See readAppSupabaseTarget in tests/e2e/fixtures.ts.',
    )
  }
  return url
}

/**
 * The other half of `assertBaseUrlIsLocal` — and the half that was missing.
 *
 * `assertBaseUrlIsLocal` proves the *browser* is talking to a local server, and
 * `tests/support/stack.ts` proves this *process* resolved a local stack. Neither
 * says anything about where the server under test sends its own writes. Nuxt
 * reads `.env` inside that process, so a developer whose `.env` names their
 * hosted project had an E2E run driving a real browser through real writes
 * straight into production, with every guard in the repo green.
 *
 * `playwright.config.ts` now injects the local stack into the server it starts,
 * which closes the default path. This closes the rest of it: `reuseExistingServer`
 * is on outside CI, so Playwright will happily attach to a preview server
 * somebody else started with whatever environment they had, and injection does
 * nothing at all in that case. This runs against the server that actually
 * answered.
 *
 * The rule itself is `assertLocalUrl`, unchanged and shared — not a second
 * opinion about what counts as local.
 */
export async function assertAppTargetsLocalStack(
  page: import('@playwright/test').Page,
): Promise<void> {
  if (targetChecked.has(page)) return
  assertLocalUrl(
    await readAppSupabaseTarget(page),
    'its Supabase URL',
    'the app under test (from NUXT_PUBLIC_SUPABASE_URL, or a .env the server picked up)',
  )
  targetChecked.add(page)
}

/**
 * Navigate, and do not return until the page is actually interactive.
 *
 * This exists because of a bug it caused in this very suite, which is worth
 * recording so nobody reintroduces it.
 *
 * Nuxt server-renders these pages, so the markup — inputs included — is present
 * and fillable well before Vue has attached to it. `page.fill()` sets the DOM
 * value and dispatches an `input` event; if that lands before hydration, there
 * is no listener yet and the value is silently dropped. The field still *shows*
 * what was typed, because the DOM value was set directly, so the test looks
 * like it worked and the application state never received anything.
 *
 * That produced a convincing false positive: a first-run "balance is lost"
 * failure that reproduced consistently against the dev server (slow hydration)
 * and not at all against a production preview (fast hydration). It was
 * initially reported as an application bug. It was not one — the app is
 * correct, and the test was racing it.
 *
 * Vue sets `__vue_app__` on the container element when it mounts, which is the
 * signal used here, together with the network going quiet — on the dev server
 * the client bundle arrives as a long tail of ES modules, and mount alone fires
 * before the page subtree is listening.
 *
 * Even this is a *timing* gate, so it is not the only defence. Anywhere the
 * result of an interaction is load-bearing, the specs additionally wait on a
 * reactive consequence — see `clickUntil` below and the way the onboarding spec
 * types the name and waits for Continue to enable before typing anything it
 * then asserts on. Timing gates make the suite fast; the reactive gates make it
 * correct.
 */
export async function gotoHydrated(page: import('@playwright/test').Page, path: string) {
  const response = await page.goto(path)
  await page.waitForFunction(() => {
    const root = document.querySelector('#__nuxt') as (Element & { __vue_app__?: unknown }) | null
    return !!root?.__vue_app__
  })
  await page.waitForLoadState('networkidle')
  // After hydration, because the runtime config is read through the Nuxt app
  // instance and there is no app instance before it mounts.
  await assertAppTargetsLocalStack(page)
  return response
}

/**
 * Click until the click actually does something.
 *
 * A click dispatched before the handler is attached is swallowed — Playwright
 * does not retry it, because from its point of view the click succeeded. Where
 * the consequence is what the test is about, retry the pair until the
 * consequence appears.
 */
export async function clickUntil(
  target: import('@playwright/test').Locator,
  consequence: import('@playwright/test').Locator,
): Promise<void> {
  await expect(async () => {
    // Checked before clicking, not after. Once the consequence is on screen the
    // target has often gone with it — a step advanced, a dialog replaced the
    // row — and clicking again would block waiting for an element that is
    // deliberately no longer there.
    if (await consequence.isVisible()) return
    // Short, because a swallowed click is the case being handled: waiting the
    // full default timeout for one would burn the retry budget on a single
    // attempt.
    await target.click({ timeout: 2_000 })
    await expect(consequence).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 20_000 })
}

/**
 * The same local-only rule the integration suite is held to, applied to the
 * browser target.
 *
 * An E2E run drives real writes through a real browser. Pointing one at a
 * deployed environment by setting an environment variable is an easy accident
 * and an expensive one, so it fails here instead.
 */
export function assertBaseUrlIsLocal(baseURL: string | undefined): void {
  if (!baseURL) throw new Error('no baseURL configured for the E2E suite')
  const host = hostOf(baseURL)
  if (!isLoopbackHost(host)) {
    throw new Error(
      `Refusing to run E2E tests against "${host}". This suite drives real writes; ` +
        'it runs against a local dev server only.',
    )
  }
  if (LOCAL_STACK) assertLocalOnly(LOCAL_STACK, 'the resolved stack')
}
