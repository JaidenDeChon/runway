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
 * Throws unless every endpoint named is on this machine.
 *
 * `label` names where the values came from, so the message points at the thing
 * to change (an environment variable, or a stack that is genuinely remote).
 */
export function assertLocalOnly(
  candidate: { readonly apiUrl: string; readonly dbUrl: string },
  label: string,
): void {
  for (const [field, url] of [
    ['apiUrl', candidate.apiUrl],
    ['dbUrl', candidate.dbUrl],
  ] as const) {
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
}

let cached: LocalStack | null | undefined

/** Test-only escape hatch so the guard's own tests can re-resolve. */
export function resetStackCache(): void {
  cached = undefined
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

  try {
    const raw = execFileSync('supabase', ['status', '-o', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const status = JSON.parse(raw) as Record<string, string>
    // ANON_KEY is the legacy JWT; PUBLISHABLE_KEY is its replacement. Newer CLI
    // versions may stop emitting the former, so accept either.
    const anonKey = status.ANON_KEY || status.PUBLISHABLE_KEY
    const serviceRoleKey = status.SERVICE_ROLE_KEY || status.SECRET_KEY
    if (!status.API_URL || !status.DB_URL || !anonKey || !serviceRoleKey) {
      cached = null
      return cached
    }
    const candidate: LocalStack = {
      apiUrl: status.API_URL,
      dbUrl: status.DB_URL,
      anonKey,
      serviceRoleKey,
      jwtSecret: status.JWT_SECRET || null,
    }
    // `supabase status` describes a local stack by construction, so this should
    // never fire. It is checked anyway: the value of a guard is that it holds
    // for the case nobody predicted.
    assertLocalOnly(candidate, '`supabase status`')
    cached = candidate
  } catch (err) {
    if (err instanceof NonLocalStackError) throw err
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
