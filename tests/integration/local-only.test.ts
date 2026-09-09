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
  extractAppSupabaseUrl,
  hostOf,
  isHostedSupabaseHost,
  isLoopbackHost,
  NonLocalStackError,
  parseDotenvValue,
  resetStackCache,
  resolveConfiguredAppSupabaseUrl,
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

/**
 * The pre-flight half of that same guard.
 *
 * `assertAppTargetsLocalStack` in `tests/e2e/fixtures.ts` only fires after a
 * build, a server boot, a browser launch and a hydrated navigation, and not at
 * all when `reuseExistingServer` attaches Playwright to a server this config
 * did not start. `tests/e2e/global-setup.ts` runs the rule before any of that,
 * against either a server already listening (probed over plain HTTP) or the
 * value the server this run starts will be handed. These are the pure pieces it
 * composes; the probe's one network call is tested in the E2E suite, not here.
 */
describe('the guard applied before Playwright starts', () => {
  const LABEL = 'the app under test'

  /**
   * The exact shape Established Facts §4 of issue #57 captured from a running
   * server: the anon key sits directly beside the URL in the inlined literal.
   */
  const SSR_HTML =
    '<!DOCTYPE html><html><body><div id="__nuxt"></div><script>' +
    'window.__NUXT__={};window.__NUXT__.config={public:{supabase:{' +
    'url:"https://examplerefxyz.supabase.co",anonKey:"dummy-anon-key-do-not-return-me"' +
    '}},app:{baseURL:"/",buildId:"ad60a7a7-ab86-4e0f-9d3f-000000000000"}};' +
    '</script></body></html>'

  it('extractAppSupabaseUrl reads the configured URL from a realistic SSR document', () => {
    expect(extractAppSupabaseUrl(SSR_HTML)).toBe('https://examplerefxyz.supabase.co')
  })

  it('extractAppSupabaseUrl returns the URL and never the anon key beside it', () => {
    const extracted = extractAppSupabaseUrl(SSR_HTML)
    expect(extracted).toBe('https://examplerefxyz.supabase.co')
    expect(extracted).not.toContain('dummy-anon-key-do-not-return-me')
  })

  it('extractAppSupabaseUrl reads a loopback URL from the same shape', () => {
    const local = SSR_HTML.replace('https://examplerefxyz.supabase.co', 'http://127.0.0.1:54321')
    expect(extractAppSupabaseUrl(local)).toBe('http://127.0.0.1:54321')
  })

  it('extractAppSupabaseUrl returns null when there is no config, so the caller fails closed', () => {
    expect(
      extractAppSupabaseUrl('<!DOCTYPE html><html><body>nothing here</body></html>'),
    ).toBeNull()
  })

  it('extractAppSupabaseUrl returns null for a config with no supabase block, so the caller fails closed', () => {
    const noSupabase = '<script>window.__NUXT__.config={public:{},app:{baseURL:"/"}};</script>'
    expect(extractAppSupabaseUrl(noSupabase)).toBeNull()
  })

  it('parseDotenvValue reads a plain assignment', () => {
    expect(
      parseDotenvValue(
        'NUXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\n',
        'NUXT_PUBLIC_SUPABASE_URL',
      ),
    ).toBe('http://127.0.0.1:54321')
  })

  it('parseDotenvValue strips surrounding single and double quotes', () => {
    expect(parseDotenvValue('KEY="http://127.0.0.1:54321"', 'KEY')).toBe('http://127.0.0.1:54321')
    expect(parseDotenvValue("KEY='http://127.0.0.1:54321'", 'KEY')).toBe('http://127.0.0.1:54321')
  })

  it('parseDotenvValue handles an export prefix and trailing whitespace', () => {
    expect(parseDotenvValue('export KEY=   http://127.0.0.1:54321   \n', 'KEY')).toBe(
      'http://127.0.0.1:54321',
    )
  })

  it('parseDotenvValue ignores a commented-out assignment', () => {
    expect(parseDotenvValue('# KEY=https://hosted.supabase.co\nOTHER=1\n', 'KEY')).toBeNull()
  })

  it('parseDotenvValue returns null for an absent key', () => {
    expect(parseDotenvValue('OTHER=1\nMORE=2\n', 'KEY')).toBeNull()
  })

  it('parseDotenvValue takes the last assignment when a key is duplicated', () => {
    expect(
      parseDotenvValue('KEY=https://hosted.supabase.co\nKEY=http://127.0.0.1:54321\n', 'KEY'),
    ).toBe('http://127.0.0.1:54321')
  })

  it('resolveConfiguredAppSupabaseUrl prefers the process environment over .env', () => {
    const KEY = 'NUXT_PUBLIC_SUPABASE_URL'
    const original = process.env[KEY]
    try {
      process.env[KEY] = 'http://127.0.0.1:54321'
      expect(resolveConfiguredAppSupabaseUrl()).toEqual({
        url: 'http://127.0.0.1:54321',
        source: 'the environment',
      })
    } finally {
      if (original === undefined) delete process.env[KEY]
      else process.env[KEY] = original
    }
  })

  it('feeds a hosted value from the environment to assertLocalUrl, which names the host and not the key', () => {
    const KEY = 'NUXT_PUBLIC_SUPABASE_URL'
    const original = process.env[KEY]
    try {
      process.env[KEY] = 'https://ceepsoecqhjekiqawjgr.supabase.co'
      const resolved = resolveConfiguredAppSupabaseUrl()
      expect(resolved?.url).toBe('https://ceepsoecqhjekiqawjgr.supabase.co')
      try {
        assertLocalUrl(resolved?.url ?? '', 'its Supabase URL', LABEL)
        expect.unreachable('expected a NonLocalStackError')
      } catch (error) {
        expect(error).toBeInstanceOf(NonLocalStackError)
        const message = (error as Error).message
        expect(message).toContain('ceepsoecqhjekiqawjgr.supabase.co')
        // No key, ever — the fixture's anon key text must not appear.
        expect(message).not.toContain('anon')
      }
    } finally {
      if (original === undefined) delete process.env[KEY]
      else process.env[KEY] = original
    }
  })

  it('rejects a hosted value parsed straight out of .env contents, naming the host', () => {
    // `export ` prefix and surrounding quotes both stripped, so the value
    // reaches `assertLocalUrl` as a parseable URL and fails on the host rather
    // than on being unreadable — a quote left attached would make this a
    // weaker "unparseable" rejection.
    const hosted = parseDotenvValue(
      'export NUXT_PUBLIC_SUPABASE_URL="https://ceepsoecqhjekiqawjgr.supabase.co"\n',
      'NUXT_PUBLIC_SUPABASE_URL',
    )
    expect(hosted).toBe('https://ceepsoecqhjekiqawjgr.supabase.co')
    expect(() => assertLocalUrl(hosted ?? '', 'its Supabase URL', LABEL)).toThrow(
      NonLocalStackError,
    )
    expect(() => assertLocalUrl(hosted ?? '', 'its Supabase URL', LABEL)).toThrow(
      /ceepsoecqhjekiqawjgr\.supabase\.co/,
    )
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
