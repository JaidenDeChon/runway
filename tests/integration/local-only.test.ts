/**
 * Issue #5: "Configuration must make it impossible to point the test runner at
 * the hosted database."
 *
 * "Impossible" is a claim about a mechanism, so there has to be a test of the
 * mechanism — not of the current configuration, which is the easy thing to
 * check and proves nothing about the next person's environment.
 *
 * This file needs no database. That is deliberate: the guard has to hold
 * *especially* on a machine where the local stack is down, because that is
 * exactly the machine where someone is tempted to point the suite at a database
 * that is up.
 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  assertLocalOnly,
  assertLocalUrl,
  hostOf,
  isHostedSupabaseHost,
  isLoopbackHost,
  NonLocalStackError,
  resetStackCache,
  resolveStack,
} from '../support/stack'

const LOCAL = {
  apiUrl: 'http://127.0.0.1:54321',
  dbUrl: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
}

/** The environment variables `global-setup` publishes and `resolveStack` reads back. */
const STACK_VARS = [
  'RUNWAY_RLS_API_URL',
  'RUNWAY_RLS_DB_URL',
  'RUNWAY_RLS_ANON_KEY',
  'RUNWAY_RLS_SERVICE_ROLE_KEY',
  'RUNWAY_RLS_JWT_SECRET',
] as const

function snapshotEnv(): Record<string, string | undefined> {
  return Object.fromEntries(STACK_VARS.map((name) => [name, process.env[name]]))
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const name of STACK_VARS) {
    const value = snapshot[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  resetStackCache()
}

/**
 * The app under test is a second thing that can be pointed at production, and
 * for a long time nothing checked it.
 *
 * `assertLocalOnly` covers the connection *this process* opens. It says nothing
 * about the Nuxt server the browser is driving, which reads its own `.env` and
 * opens its own connection — so a developer whose `.env` named their hosted
 * project got an E2E run writing real rows into production with every guard in
 * the repo green. `tests/e2e/fixtures.ts` now applies the same rule to the
 * running app; these are the tests of the rule it applies.
 *
 * Tested here rather than in the E2E suite on purpose, and for this file's own
 * stated reason: the guard has to hold especially on a machine where the local
 * stack is down, which is exactly the machine where nothing E2E can run.
 */
describe('the guard applied to the app under test', () => {
  const LABEL = 'the app under test'

  it('passes an app pointed at the local stack', () => {
    expect(() => assertLocalUrl(LOCAL.apiUrl, 'its Supabase URL', LABEL)).not.toThrow()
    expect(() => assertLocalUrl('http://localhost:54321', 'its Supabase URL', LABEL)).not.toThrow()
  })

  it('refuses an app pointed at a hosted project — the case that prompted this', () => {
    expect(() =>
      assertLocalUrl('https://ceepsoecqhjekiqawjgr.supabase.co', 'its Supabase URL', LABEL),
    ).toThrow(NonLocalStackError)
  })

  it('names the app, so the message points at the .env and not at the harness', () => {
    // The failure this replaces was every spec redirecting to /sign-in, because
    // the app looked for a cookie named after a different project. Nothing in
    // that said "your .env is wrong".
    try {
      assertLocalUrl('https://ceepsoecqhjekiqawjgr.supabase.co', 'its Supabase URL', LABEL)
      expect.unreachable('expected a NonLocalStackError')
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain(LABEL)
      expect(message).toContain('its Supabase URL')
    }
  })

  it('refuses any other remote host, not only the hosted platform', () => {
    expect(() => assertLocalUrl('https://supabase.example.com', 'its Supabase URL', LABEL)).toThrow(
      NonLocalStackError,
    )
  })

  it('refuses an unreadable value rather than letting it through', () => {
    // What an app with the variable unset or blank would report.
    for (const value of ['', 'undefined', 'not-a-url']) {
      expect(() => assertLocalUrl(value, 'its Supabase URL', LABEL)).toThrow(NonLocalStackError)
    }
  })

  it('is the same function assertLocalOnly uses, not a second opinion', () => {
    // Both must reject the identical host for the identical reason; two
    // implementations of "local" would eventually disagree.
    const hosted = 'https://ceepsoecqhjekiqawjgr.supabase.co'
    const fromPair = (() => {
      try {
        assertLocalOnly({ apiUrl: hosted, dbUrl: LOCAL.dbUrl }, LABEL)
      } catch (error) {
        return (error as Error).message
      }
      return null
    })()
    const fromSingle = (() => {
      try {
        assertLocalUrl(hosted, 'apiUrl', LABEL)
      } catch (error) {
        return (error as Error).message
      }
      return null
    })()
    expect(fromSingle).not.toBeNull()
    expect(fromPair).toBe(fromSingle)
  })
})

describe('the local-only guard', () => {
  it('accepts every loopback spelling', () => {
    for (const host of ['127.0.0.1', 'localhost', '::1', '0.0.0.0']) {
      expect(isLoopbackHost(host)).toBe(true)
    }
  })

  it('recognises the hosted platform', () => {
    for (const host of [
      'abcdefghijklmnop.supabase.co',
      'abcdefghijklmnop.supabase.in',
      'db.abcdefghijklmnop.supabase.net',
      'api.supabase.com',
    ]) {
      expect(isHostedSupabaseHost(host)).toBe(true)
    }
    expect(isHostedSupabaseHost('127.0.0.1')).toBe(false)
    // Not a Supabase host despite containing the string — the check is on the
    // suffix, not on a substring, so this must not match.
    expect(isHostedSupabaseHost('supabase.co.example.com')).toBe(false)
  })

  it('parses IPv6 hosts without their brackets', () => {
    expect(hostOf('http://[::1]:54321')).toBe('::1')
  })

  it('passes a genuine local stack', () => {
    expect(() => assertLocalOnly(LOCAL, 'the test')).not.toThrow()
  })

  it('refuses a hosted API URL, and says so', () => {
    expect(() =>
      assertLocalOnly({ ...LOCAL, apiUrl: 'https://abcdefghijklmnop.supabase.co' }, 'the test'),
    ).toThrow(NonLocalStackError)
    expect(() =>
      assertLocalOnly({ ...LOCAL, apiUrl: 'https://abcdefghijklmnop.supabase.co' }, 'the test'),
    ).toThrow(/hosted Supabase host/)
  })

  it('refuses a hosted database URL even when the API URL is local', () => {
    expect(() =>
      assertLocalOnly(
        {
          ...LOCAL,
          dbUrl: 'postgresql://postgres:hunter2@db.abcdefghijklmnop.supabase.co:5432/postgres',
        },
        'the test',
      ),
    ).toThrow(NonLocalStackError)
  })

  it('refuses any other remote host, hosted platform or not', () => {
    expect(() =>
      assertLocalOnly({ ...LOCAL, apiUrl: 'https://db.internal.example.com' }, 'the test'),
    ).toThrow(/not this machine/)
  })

  it('refuses a URL it cannot parse rather than letting it through', () => {
    expect(() => assertLocalOnly({ ...LOCAL, apiUrl: 'not-a-url' }, 'the test')).toThrow(
      NonLocalStackError,
    )
  })

  /**
   * The specific hole this guard was written to close.
   *
   * `global-setup` publishes the resolved stack into `RUNWAY_RLS_*` so workers
   * skip their own `supabase status` subprocess, and nothing used to check those
   * values on the way back in. Setting one by hand was enough to redirect every
   * suite — including the negative control, which deliberately widens an RLS
   * policy — at whatever database was named.
   */
  it('refuses a hosted endpoint injected through the environment', () => {
    const snapshot = snapshotEnv()
    try {
      resetStackCache()
      process.env.RUNWAY_RLS_API_URL = 'https://abcdefghijklmnop.supabase.co'
      process.env.RUNWAY_RLS_DB_URL =
        'postgresql://postgres:hunter2@db.abcdefghijklmnop.supabase.co:5432/postgres'
      process.env.RUNWAY_RLS_ANON_KEY = 'irrelevant'
      process.env.RUNWAY_RLS_SERVICE_ROLE_KEY = 'irrelevant'

      expect(() => resolveStack()).toThrow(NonLocalStackError)
    } finally {
      restoreEnv(snapshot)
    }
  })

  it('never puts a connection string in the message it throws', () => {
    const dbUrl = 'postgresql://postgres:hunter2@db.abcdefghijklmnop.supabase.co:5432/postgres'
    try {
      assertLocalOnly({ ...LOCAL, dbUrl }, 'the test')
      throw new Error('expected assertLocalOnly to throw')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // CI logs must not contain connection strings. The host is enough to act on.
      expect(message).not.toContain('hunter2')
      expect(message).not.toContain('postgresql://')
      expect(message).toContain('db.abcdefghijklmnop.supabase.co')
    }
  })

  afterEach(() => {
    resetStackCache()
  })
})
