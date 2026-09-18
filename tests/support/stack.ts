/**
 * Resolving the local Supabase stack — and refusing to resolve anything else.
 *
 * Issue #5: "Configuration must make it impossible to point the test runner at
 * the hosted database." This module is where that is enforced, for every suite
 * that touches a database: the integration project and the Playwright E2E
 * harness both come through here and there is no second door.
 *
 * The pre-existing posture was already good — credentials came from
 * `supabase status`, which only ever describes the local stack. It was not
 * airtight. `tests/rls/global-setup.ts` published the resolved values into
 * `RUNWAY_RLS_*` environment variables so each worker did not pay for its own
 * subprocess, and nothing checked those variables on the way back in. Exporting
 * `RUNWAY_RLS_API_URL=https://<ref>.supabase.co` was enough to aim the whole
 * suite — including the tests that deliberately widen a policy — at production.
 *
 * So the guard is applied to the *resolved* stack, whichever source it came
 * from, rather than to the source. A hostile or careless environment variable
 * now fails the run instead of redirecting it.
 *
 * One detail that looks like paranoia and is not: no error raised here ever
 * interpolates a URL. A database URL is a connection string with a password in
 * it, and the issue also requires that CI logs never contain one. Failures name
 * the *host* and the variable, which is all a reader needs to fix it.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export interface LocalStack {
  readonly apiUrl: string
  readonly dbUrl: string
  readonly anonKey: string
  readonly serviceRoleKey: string
  /**
   * The local stack's JWT signing secret, when the CLI reports it. Used only to
   * mint the deliberately-expired tokens the auth-context helpers need; `null`
   * when unavailable, which those helpers handle by skipping rather than by
   * pretending.
   */
  readonly jwtSecret: string | null
}

/**
 * Hosts a test database is allowed to live on. Loopback only — a stack the
 * developer is running, on the machine running the tests.
 *
 * `0.0.0.0` is here because the CLI reports it in some container setups. It
 * means "this machine" at the point we are connecting *from*, so it is local in
 * the sense that matters.
 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0'])

/**
 * Suffixes belonging to Supabase's hosted platform.
 *
 * Redundant against the loopback allow-list above, and kept anyway: it turns
 * the one mistake that actually matters — pointing at a real project — into an
 * error that says so, instead of a generic "not a loopback host".
 */
const HOSTED_SUFFIXES = ['.supabase.co', '.supabase.in', '.supabase.net', '.supabase.com']

/** Hostname of a URL, with IPv6 brackets stripped. Empty string when unparseable. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase()
  } catch {
    return ''
  }
}

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host)
}

export function isHostedSupabaseHost(host: string): boolean {
  return HOSTED_SUFFIXES.some((suffix) => host.endsWith(suffix))
}

export class NonLocalStackError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NonLocalStackError'
  }
}

/**
 * Throws unless one endpoint is on this machine.
 *
 * `field` names the endpoint and `label` names where the value came from, so
 * the message points at the thing to change — an environment variable, a stack
 * that is genuinely remote, or the server under test.
 *
 * This is the whole rule, in one place. `assertLocalOnly` below is a loop over
 * it, and the E2E harness applies the same function to the *app* it is driving
 * (`tests/e2e/fixtures.ts`). There is deliberately no second copy: a guard
 * whose two implementations can drift is a guard that will eventually disagree
 * with itself about what "local" means.
 */
export function assertLocalUrl(url: string, field: string, label: string): void {
  const host = hostOf(url)

  if (!host) {
    throw new NonLocalStackError(
      `Refusing to run: ${label} supplied a ${field} that is not a parseable URL. ` +
        'The test suites only ever run against a local Supabase stack.',
    )
  }

  if (isHostedSupabaseHost(host)) {
    throw new NonLocalStackError(
      `Refusing to run: ${label} points ${field} at the hosted Supabase host "${host}". ` +
        'These suites create, mutate and delete rows, and one of them deliberately ' +
        'widens an RLS policy. They run against a local stack only.',
    )
  }

  if (!isLoopbackHost(host)) {
    throw new NonLocalStackError(
      `Refusing to run: ${label} points ${field} at "${host}", which is not this machine. ` +
        `Allowed hosts: ${[...LOOPBACK_HOSTS].join(', ')}.`,
    )
  }
}

/**
 * Throws unless every endpoint named is on this machine.
 *
 * `label` names where the values came from, so the message points at the thing
 * to change (an environment variable, or a stack that is genuinely remote).
 */
export function assertLocalOnly(
  candidate: { readonly apiUrl: string; readonly dbUrl: string },
  label: string,
): void {
  assertLocalUrl(candidate.apiUrl, 'apiUrl', label)
  assertLocalUrl(candidate.dbUrl, 'dbUrl', label)
}

let cached: LocalStack | null | undefined

/**
 * Why the last `resolveStack()` came back `null`, in words safe to print.
 *
 * Issue #68: every failure below used to collapse into a bare `null`, so the
 * guard could only report the symptom — "not reachable" — for a stack that was
 * demonstrably up and answering. That sends the next person looking at Docker
 * when the real cause was a spawn, an exit code, or a parse. It is also the
 * exact shape of nuisance that gets `RUNWAY_RLS_REQUIRE_STACK` switched off,
 * which is the one outcome `docs/testing.md` says must never happen.
 *
 * **Never the output itself.** `supabase status` prints the anon key, the
 * service-role key, the JWT secret and a connection string, and a failed
 * `execFileSync` carries that output on the thrown error. So this records the
 * *kind* of failure and the safe particulars only — an errno, an exit code, the
 * names of the keys that were missing — per CLAUDE.md on what may reach a log.
 */
let lastFailure: string | null = null

/**
 * The reason the last resolution failed, or `null` if it succeeded or has not
 * run. Read by the `RUNWAY_RLS_REQUIRE_STACK=1` guards so their message names
 * the cause rather than only the symptom.
 */
export function stackResolutionFailure(): string | null {
  return lastFailure
}

/**
 * The sentence the `RUNWAY_RLS_REQUIRE_STACK=1` guards append to "not
 * reachable", or an empty string when the resolver has nothing to add.
 *
 * Shared so both guards — `tests/support/global-setup.ts` for the integration
 * project and `requireStackOrSkip` for E2E — say the same thing. Neither guard
 * is softened by this: the throw is unconditional exactly as before, and this
 * only tells the reader where to look.
 */
export function describeStackResolution(): string {
  const reason = stackResolutionFailure()
  if (!reason) return ''
  return (
    ` The resolver did not simply find an absent stack — it failed: ${reason}. ` +
    'If the stack is in fact up (`curl http://127.0.0.1:54321/rest/v1/`), export the ' +
    'RUNWAY_RLS_* variables instead, which skip the subprocess and are still loopback-checked.'
  )
}

/** Test-only escape hatch so the guard's own tests can re-resolve. */
export function resetStackCache(): void {
  cached = undefined
  lastFailure = null
}

/**
 * Turns whatever `execFileSync` threw into one safe sentence.
 *
 * Node puts an errno on a spawn failure (`ENOENT` when the CLI is not on PATH)
 * and a `status` on a non-zero exit. Both are printable. `stdout`/`stderr` on
 * the error are not, and are never read here.
 */
function describeSpawnFailure(err: unknown): string {
  const code = (err as { code?: unknown }).code
  const status = (err as { status?: unknown }).status
  if (code === 'ENOENT') {
    return '`supabase` could not be spawned (ENOENT) — the CLI is not on PATH for this process'
  }
  if (typeof code === 'string') return `\`supabase status\` could not be spawned (${code})`
  if (typeof status === 'number') return `\`supabase status\` exited with code ${status}`
  const name = err instanceof Error ? err.name : typeof err
  return `\`supabase status\` failed to run (${name})`
}

/**
 * The local stack's connection details, or `null` when it is not running.
 *
 * Two sources, one guard. The `RUNWAY_RLS_*` variables are the fast path —
 * `tests/support/global-setup.ts` fills them once per run so each worker skips
 * its own `supabase status` subprocess. The subprocess is the fallback, for a
 * single file run straight from an editor.
 *
 * A stack that resolves but is not local throws rather than returning `null`:
 * "not running" is a condition tests may skip on, and "pointed somewhere it
 * must never be pointed" is not.
 */
export function resolveStack(): LocalStack | null {
  if (cached !== undefined) return cached

  const fromEnv = process.env.RUNWAY_RLS_API_URL
  if (fromEnv) {
    const candidate: LocalStack = {
      apiUrl: fromEnv,
      dbUrl: process.env.RUNWAY_RLS_DB_URL ?? '',
      anonKey: process.env.RUNWAY_RLS_ANON_KEY ?? '',
      serviceRoleKey: process.env.RUNWAY_RLS_SERVICE_ROLE_KEY ?? '',
      jwtSecret: process.env.RUNWAY_RLS_JWT_SECRET || null,
    }
    assertLocalOnly(candidate, 'the RUNWAY_RLS_* environment variables')
    cached = candidate
    return cached
  }

  let raw: string
  try {
    raw = execFileSync('supabase', ['status', '-o', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch (err) {
    lastFailure = describeSpawnFailure(err)
    cached = null
    return cached
  }

  try {
    // Parsed in its own try so a `JSON.parse` throw is not reported as a spawn
    // failure. `supabase status` also writes a "Stopped services" line and an
    // upgrade notice, but to stderr — discarded above — so output that is not
    // JSON here means something else, and saying so is the point.
    const status = JSON.parse(raw) as Record<string, string>
    // ANON_KEY is the legacy JWT; PUBLISHABLE_KEY is its replacement. Newer CLI
    // versions may stop emitting the former, so accept either.
    const anonKey = status.ANON_KEY || status.PUBLISHABLE_KEY
    const serviceRoleKey = status.SERVICE_ROLE_KEY || status.SECRET_KEY
    const apiUrl = status.API_URL
    const dbUrl = status.DB_URL
    // Collected rather than short-circuited so one run names every missing
    // field, not just the first — the reader is usually looking at a CLI whose
    // output shape changed, and one name at a time is three runs.
    const missing = [
      apiUrl ? null : 'API_URL',
      dbUrl ? null : 'DB_URL',
      anonKey ? null : 'ANON_KEY/PUBLISHABLE_KEY',
      serviceRoleKey ? null : 'SERVICE_ROLE_KEY/SECRET_KEY',
    ].filter((name): name is string => name !== null)
    if (!apiUrl || !dbUrl || !anonKey || !serviceRoleKey) {
      // Names only. The values are exactly the secrets that must not be logged.
      lastFailure =
        `\`supabase status\` returned JSON without ${missing.join(', ')} ` +
        `(${Object.keys(status).length} field(s) present)`
      cached = null
      return cached
    }
    const candidate: LocalStack = {
      apiUrl,
      dbUrl,
      anonKey,
      serviceRoleKey,
      jwtSecret: status.JWT_SECRET || null,
    }
    // `supabase status` describes a local stack by construction, so this should
    // never fire. It is checked anyway: the value of a guard is that it holds
    // for the case nobody predicted.
    assertLocalOnly(candidate, '`supabase status`')
    lastFailure = null
    cached = candidate
  } catch (err) {
    // A stack pointed somewhere it must never be pointed is not a resolution
    // failure to describe — it is a refusal, and it keeps propagating.
    if (err instanceof NonLocalStackError) throw err
    // Deliberately not `err.message`. V8 quotes the offending input back in a
    // `JSON.parse` SyntaxError ("Unexpected token 'S', \"…\" is not valid
    // JSON"), and the input here is the banner carrying the anon key, the
    // service-role key and the JWT secret. A length is a count and is safe;
    // the text is not.
    lastFailure =
      err instanceof SyntaxError
        ? `\`supabase status\` returned ${raw.length} character(s) that are not JSON`
        : `\`supabase status\` output could not be read (${err instanceof Error ? err.name : typeof err})`
    cached = null
  }
  return cached
}

/** Publishes a resolved stack to the worker processes. Guarded on the way out too. */
export function publishStackToEnvironment(stack: LocalStack): void {
  assertLocalOnly(stack, 'the resolved stack')
  process.env.RUNWAY_RLS_API_URL = stack.apiUrl
  process.env.RUNWAY_RLS_DB_URL = stack.dbUrl
  process.env.RUNWAY_RLS_ANON_KEY = stack.anonKey
  process.env.RUNWAY_RLS_SERVICE_ROLE_KEY = stack.serviceRoleKey
  if (stack.jwtSecret) process.env.RUNWAY_RLS_JWT_SECRET = stack.jwtSecret
}

/**
 * ── Where the *application under test* points ────────────────────────────────
 *
 * `assertLocalOnly` above guards the connection *this process* opens;
 * `tests/e2e/fixtures.ts`'s `assertBaseUrlIsLocal` guards the URL the *browser*
 * is aimed at. Neither says anything about where the Nuxt server the browser is
 * driving sends its own writes — that server reads `NUXT_PUBLIC_SUPABASE_URL`
 * from its own environment (`shared/supabase/config.ts`), so a developer whose
 * `.env` names their hosted project could get an E2E run driving a real sign-up
 * straight into `auth.users` on production, with every other guard in this repo
 * green. That is issue #57.
 *
 * `assertAppTargetsLocalStack` in `tests/e2e/fixtures.ts` already closes it from
 * inside the browser — but only after a build, a server boot, a browser launch
 * and a hydrated navigation, and not at all for a bare `page.goto` that skips
 * `gotoHydrated`. `tests/e2e/global-setup.ts` applies the same `assertLocalUrl`
 * rule *before* Playwright starts anything, and these are the pure pieces it
 * composes: no network, no clock, synchronous, testable with a string and
 * nothing else. The one network call it needs — probing a server that is
 * already listening — stays in `global-setup.ts`, not here.
 */

/**
 * Reads a single `KEY=VALUE` out of dotenv file *contents*.
 *
 * A string in, so it is testable with no filesystem. It mirrors the slice of
 * dotenv semantics that matters here and no more: an `export ` prefix, `#`
 * comment lines, surrounding single or double quotes, surrounding whitespace,
 * and last-assignment-wins on a duplicated key. Returns `null` when the key is
 * absent; a bare `KEY=` returns `''`, which callers treat as "not configured"
 * exactly as a shell would.
 */
export function parseDotenvValue(contents: string, key: string): string | null {
  let value: string | null = null
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const body = line.startsWith('export ') ? line.slice(7).trimStart() : line
    const eq = body.indexOf('=')
    if (eq === -1) continue
    if (body.slice(0, eq).trim() !== key) continue
    let raw = body.slice(eq + 1).trim()
    if (
      raw.length >= 2 &&
      ((raw[0] === '"' && raw.at(-1) === '"') || (raw[0] === "'" && raw.at(-1) === "'"))
    ) {
      raw = raw.slice(1, -1)
    }
    // Last assignment wins, matching dotenv — keep going rather than returning.
    value = raw
  }
  return value
}

/**
 * Pulls `config.public.supabase.url` out of a Nuxt SSR HTML response.
 *
 * Nuxt inlines runtime config into the document as
 * `window.__NUXT__.config={public:{supabase:{url:"…",anonKey:"…"}},…}`. The
 * anon key sits directly beside the URL in that literal, so this captures the
 * URL group and *only* the URL group: a caller must never end up with the
 * surrounding text in hand. Returns `null` when the shape is not found — Nuxt
 * changed how it inlines config, or the response is not a Nuxt document — and
 * callers fail closed rather than guess.
 */
export function extractAppSupabaseUrl(html: string): string | null {
  const match = html.match(/supabase\s*:\s*\{[^}]*?\burl\s*:\s*(["'])((?:(?!\1)[\s\S])*)\1/)
  return match?.[2] ?? null
}

/**
 * The `NUXT_PUBLIC_SUPABASE_URL` a Nuxt server started under this repo's config
 * would actually use, resolved with Nuxt's own precedence:
 *
 *  1. an already-set process variable — Nuxt's dotenv loading does not
 *     overwrite what the environment already provides;
 *  2. otherwise the value in the repo's `.env`;
 *  3. otherwise nothing.
 *
 * `source` names which of those it came from, so a failure points at the thing
 * to change. An empty value from either source counts as "not set": an app
 * handed an empty URL fails to configure at boot (`shared/supabase/config.ts`),
 * so there is nothing to guard and `null` is the honest answer.
 *
 * `.env` is read relative to this module, and its absence is tolerated — a
 * checkout with no `.env` at all resolves to `null`, not to a crash.
 */
export function resolveConfiguredAppSupabaseUrl(): { url: string; source: string } | null {
  const fromEnv = process.env.NUXT_PUBLIC_SUPABASE_URL?.trim()
  if (fromEnv) return { url: fromEnv, source: 'the environment' }

  let contents: string
  try {
    contents = readFileSync(new URL('../../.env', import.meta.url), 'utf8')
  } catch {
    return null
  }

  const fromDotenv = parseDotenvValue(contents, 'NUXT_PUBLIC_SUPABASE_URL')?.trim()
  if (fromDotenv) return { url: fromDotenv, source: '.env' }

  return null
}
