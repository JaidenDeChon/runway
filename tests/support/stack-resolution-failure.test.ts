/**
 * What `resolveStack()` says when it fails — issue #68.
 *
 * Every failure used to collapse into a bare `null`, so the
 * `RUNWAY_RLS_REQUIRE_STACK=1` guards could only report the symptom ("the
 * local Supabase stack is not reachable") even when the stack was up and
 * answering and the real cause was a spawn, an exit code or a parse. That
 * sends the reader to Docker, and the shortcut out of the nuisance is to
 * switch the guard off — the one outcome `docs/testing.md` rules out.
 *
 * The other half of the job is what these reasons must **never** contain.
 * `supabase status` prints the anon key, the service-role key, the JWT secret
 * and a database connection string. A failed `execFileSync` carries that output
 * on the thrown error, and V8 quotes the offending input back inside a
 * `JSON.parse` SyntaxError. So the last test here is the load-bearing one:
 * no reason may carry a secret, whatever the CLI emitted.
 *
 * `execFileSync` is mocked. Nothing here starts a stack, needs Docker, or
 * touches a network — which is why it lives in the unit project.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const execFileSync = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execFileSync }))

const { describeStackResolution, resetStackCache, resolveStack, stackResolutionFailure } =
  await import('./stack')

/** Stand-ins, shaped like the real thing and worth nothing anywhere. */
const FAKE_ANON_KEY = 'fake-anon-key-aaaaaaaaaaaaaaaaaaaa'
const FAKE_SERVICE_KEY = 'fake-service-role-key-bbbbbbbbbbbb'
const FAKE_JWT_SECRET = 'fake-jwt-secret-cccccccccccccccccccc'
const FAKE_DB_URL = 'postgresql://postgres:fake-password@127.0.0.1:54322/postgres'

const HEALTHY_STATUS = {
  API_URL: 'http://127.0.0.1:54321',
  DB_URL: FAKE_DB_URL,
  ANON_KEY: FAKE_ANON_KEY,
  SERVICE_ROLE_KEY: FAKE_SERVICE_KEY,
  JWT_SECRET: FAKE_JWT_SECRET,
}

/** Every secret-shaped string the CLI could have emitted, in one place. */
const SECRETS = [FAKE_ANON_KEY, FAKE_SERVICE_KEY, FAKE_JWT_SECRET, FAKE_DB_URL]

/**
 * A *prefix* counts as a leak, which is the whole reason this is not a plain
 * `toContain` on the full value. V8 truncates the input it quotes back inside a
 * `JSON.parse` SyntaxError to about a dozen characters — `Unexpected token
 * 'k', "fake-anon-ke"... is not valid JSON` — so a message built from
 * `err.message` would disclose the front of a key while passing a whole-value
 * check. Twelve is the length V8 actually uses.
 */
const LEAK_PREFIX_LENGTH = 12

function assertNoSecret(reported: string): void {
  for (const secret of SECRETS) {
    expect(reported).not.toContain(secret)
    expect(reported).not.toContain(secret.slice(0, LEAK_PREFIX_LENGTH))
  }
}

function throwing(properties: Record<string, unknown>): () => never {
  return () => {
    throw Object.assign(new Error('mocked failure'), properties)
  }
}

beforeEach(() => {
  execFileSync.mockReset()
  resetStackCache()
  // The RUNWAY_RLS_* fast path short-circuits the subprocess entirely, and
  // these tests are about the subprocess.
  for (const key of [
    'RUNWAY_RLS_API_URL',
    'RUNWAY_RLS_DB_URL',
    'RUNWAY_RLS_ANON_KEY',
    'RUNWAY_RLS_SERVICE_ROLE_KEY',
    'RUNWAY_RLS_JWT_SECRET',
  ]) {
    delete process.env[key]
  }
})

describe('resolveStack names why it failed', () => {
  it('reports a CLI that is not on PATH as exactly that', () => {
    execFileSync.mockImplementation(throwing({ code: 'ENOENT' }))
    expect(resolveStack()).toBeNull()
    expect(stackResolutionFailure()).toMatch(/ENOENT/)
    expect(stackResolutionFailure()).toMatch(/PATH/)
  })

  it('reports a non-zero exit with its code', () => {
    execFileSync.mockImplementation(throwing({ status: 1 }))
    expect(resolveStack()).toBeNull()
    expect(stackResolutionFailure()).toMatch(/exited with code 1/)
  })

  it('reports output that is not JSON without quoting it', () => {
    execFileSync.mockReturnValue('Stopped services: [supabase_db_runway]')
    expect(resolveStack()).toBeNull()
    expect(stackResolutionFailure()).toMatch(/not JSON/)
    // A length is a count; the text is not ours to print.
    expect(stackResolutionFailure()).not.toMatch(/Stopped services/)
  })

  it('names the fields that were missing, and only their names', () => {
    execFileSync.mockReturnValue(
      JSON.stringify({ API_URL: 'http://127.0.0.1:54321', ANON_KEY: FAKE_ANON_KEY }),
    )
    expect(resolveStack()).toBeNull()
    const reason = stackResolutionFailure() ?? ''
    expect(reason).toMatch(/DB_URL/)
    expect(reason).toMatch(/SERVICE_ROLE_KEY/)
    expect(reason).not.toMatch(/API_URL,/) // the one that was present
  })

  it('clears the reason once resolution succeeds', () => {
    execFileSync.mockImplementation(throwing({ code: 'ENOENT' }))
    expect(resolveStack()).toBeNull()
    expect(stackResolutionFailure()).not.toBeNull()

    resetStackCache()
    execFileSync.mockReturnValue(JSON.stringify(HEALTHY_STATUS))
    expect(resolveStack()?.apiUrl).toBe('http://127.0.0.1:54321')
    expect(stackResolutionFailure()).toBeNull()
  })
})

describe('the loopback check is not weakened by any of this', () => {
  // Issue #68's third acceptance criterion. Naming the failure must not turn a
  // refusal into a reason: a stack pointed somewhere it must never be pointed
  // still throws, rather than becoming a `null` with an explanation attached.
  it('still throws for a non-loopback endpoint instead of reporting it as a failure', () => {
    execFileSync.mockReturnValue(
      JSON.stringify({ ...HEALTHY_STATUS, API_URL: 'https://abcdefghijkl.supabase.co' }),
    )
    expect(() => resolveStack()).toThrow()
  })

  it('leaves no swallowed reason behind after such a refusal', () => {
    execFileSync.mockReturnValue(
      JSON.stringify({ ...HEALTHY_STATUS, API_URL: 'https://abcdefghijkl.supabase.co' }),
    )
    expect(() => resolveStack()).toThrow()
    // The throw is the report. A reason here would suggest the run merely
    // failed to resolve, which is a much milder thing than what happened.
    expect(stackResolutionFailure()).toBeNull()
  })
})

describe('the sentence the guards append', () => {
  it('is empty when there is nothing to add', () => {
    execFileSync.mockReturnValue(JSON.stringify(HEALTHY_STATUS))
    resolveStack()
    expect(describeStackResolution()).toBe('')
  })

  it('points at the supported workaround when the resolver itself failed', () => {
    execFileSync.mockImplementation(throwing({ code: 'ENOENT' }))
    resolveStack()
    const sentence = describeStackResolution()
    expect(sentence).toMatch(/ENOENT/)
    // The documented path, which is still loopback-checked — not a way around
    // the guard. See docs/testing.md and issue #68.
    expect(sentence).toMatch(/RUNWAY_RLS_\*/)
  })
})

describe('no failure reason ever carries a secret', () => {
  // The whole point of the issue's fix is a message people will read and paste.
  // CLAUDE.md: never a token or a connection string, not even in an assertion.
  const cases: { name: string; arrange: () => void }[] = [
    {
      name: 'the CLI printed the key banner instead of JSON',
      arrange: () => {
        execFileSync.mockReturnValue(
          `Stopped services: [supabase_imgproxy]\nAPI URL: http://127.0.0.1:54321\n` +
            `anon key: ${FAKE_ANON_KEY}\nservice_role key: ${FAKE_SERVICE_KEY}\n` +
            `JWT secret: ${FAKE_JWT_SECRET}\nDB URL: ${FAKE_DB_URL}\n`,
        )
      },
    },
    {
      name: 'the CLI exited non-zero with the banner on the error',
      arrange: () => {
        execFileSync.mockImplementation(
          throwing({
            status: 1,
            stdout: `anon key: ${FAKE_ANON_KEY}\nservice_role key: ${FAKE_SERVICE_KEY}`,
            stderr: `JWT secret: ${FAKE_JWT_SECRET}`,
          }),
        )
      },
    },
    {
      name: 'the JSON parsed but was missing required fields',
      arrange: () => {
        execFileSync.mockReturnValue(
          JSON.stringify({ ANON_KEY: FAKE_ANON_KEY, JWT_SECRET: FAKE_JWT_SECRET }),
        )
      },
    },
    {
      // The case that makes the prefix check bite: the output *starts* with a
      // key, so V8's quoted snippet is the front of that key.
      name: 'the output begins with a key rather than a banner line',
      arrange: () => {
        execFileSync.mockReturnValue(FAKE_ANON_KEY)
      },
    },
  ]

  for (const { name, arrange } of cases) {
    it(`keeps every secret out of the reason when ${name}`, () => {
      arrange()
      expect(resolveStack()).toBeNull()
      const reported = `${stackResolutionFailure() ?? ''}${describeStackResolution()}`
      expect(reported).not.toBe('')
      assertNoSecret(reported)
    })
  }
})
