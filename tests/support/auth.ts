/**
 * The four auth contexts issue #5 names: valid user, second user,
 * unauthenticated, expired session.
 *
 * Each context answers one question — "what does the data layer do for
 * *this* caller?" — and answers it the same way, so a test can loop over all
 * four and assert what each is allowed to see.
 *
 * Every context carries a `restSelect` that talks to PostgREST over plain
 * `fetch` with headers it sets itself. That is deliberate. `supabase-js`
 * decides for itself when to attach a session and when to fall back to the anon
 * key, and those rules have changed between minor versions; an "unauthenticated
 * reads nothing" test that silently became an "anon key reads nothing" test
 * would still be green. The raw call means the request on the wire is the one
 * the test says it is making. `client` is still here for the ergonomic cases.
 */

import {
  anonClient,
  type RunwayTestClient,
  requireStack,
  type SeedUser,
  signedInSession,
  USER_A,
  USER_B,
} from './database'
import { localIssuer, mintAccessToken, resolveVerifiedJwtSecret } from './jwt'

export type AuthContextName = 'valid-user' | 'second-user' | 'unauthenticated' | 'expired-session'

export interface RestResult {
  readonly status: number
  readonly rows: readonly Record<string, unknown>[]
  /** PostgREST's error code (e.g. `PGRST301`), when it returned one. */
  readonly code: string | null
}

export interface AuthContext {
  readonly name: AuthContextName
  /** The user this context speaks for, or `null` when it speaks for nobody. */
  readonly userId: string | null
  readonly client: RunwayTestClient
  /** A direct PostgREST read, with exactly the headers this context implies. */
  readonly restSelect: (table: string, columns?: string) => Promise<RestResult>
}

/**
 * A PostgREST GET with an explicit bearer token.
 *
 * `apikey` is always the anon key — that is what the Data API gateway
 * authenticates the *project* with, and it is public by design. What varies
 * between contexts is the `Authorization` bearer, which is what identifies the
 * *user*. Conflating the two is the mistake this helper exists to avoid.
 */
async function restSelectWithToken(
  bearer: string,
  table: string,
  columns: string,
): Promise<RestResult> {
  const stack = requireStack()
  const url = `${stack.apiUrl.replace(/\/$/, '')}/rest/v1/${table}?select=${encodeURIComponent(columns)}`
  const response = await fetch(url, {
    headers: {
      apikey: stack.anonKey,
      Authorization: `Bearer ${bearer}`,
      Accept: 'application/json',
    },
  })

  const text = await response.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = null
  }

  if (Array.isArray(parsed)) {
    return { status: response.status, rows: parsed as Record<string, unknown>[], code: null }
  }
  const code =
    parsed && typeof parsed === 'object' && typeof (parsed as { code?: unknown }).code === 'string'
      ? (parsed as { code: string }).code
      : null
  return { status: response.status, rows: [], code }
}

async function signedInContext(user: SeedUser, name: AuthContextName): Promise<AuthContext> {
  const session = await signedInSession(user)
  const client = anonClient()
  const { error } = await client.auth.setSession({
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
  })
  if (error) throw new Error(`could not attach the session for ${user.email}: ${error.message}`)

  return {
    name,
    userId: user.id,
    client,
    restSelect: (table, columns = '*') => restSelectWithToken(session.accessToken, table, columns),
  }
}

/** The ordinary signed-in caller. */
export function validUserContext(): Promise<AuthContext> {
  return signedInContext(USER_A, 'valid-user')
}

/** A different signed-in caller — the one whose rows the first must never see. */
export function secondUserContext(): Promise<AuthContext> {
  return signedInContext(USER_B, 'second-user')
}

/**
 * The anonymous public: the anon key and nothing else.
 *
 * This is the browser before sign-in, and the anon key ships in the bundle by
 * design. What closes the door is the privilege revocation plus RLS, not the
 * secrecy of the key.
 */
export function unauthenticatedContext(): AuthContext {
  const stack = requireStack()
  return {
    name: 'unauthenticated',
    userId: null,
    client: anonClient(),
    restSelect: (table, columns = '*') => restSelectWithToken(stack.anonKey, table, columns),
  }
}

/**
 * A caller holding a correctly-signed token that has already expired.
 *
 * `null` when the local signing secret could not be verified — see
 * `tests/support/jwt.ts`. Callers skip in that case; they must not fall back to
 * a malformed token and call it the same test, because a malformed token is
 * rejected by a different code path than an expired one.
 */
export async function expiredSessionContext(): Promise<AuthContext | null> {
  const probe = async (token: string): Promise<boolean> => {
    const result = await restSelectWithToken(token, 'accounts', 'id')
    return result.status === 200
  }

  const secret = await resolveVerifiedJwtSecret(USER_A.id, probe)
  if (!secret) return null

  const expired = mintAccessToken({
    userId: USER_A.id,
    email: USER_A.email,
    // Well past any tolerated clock skew, so this can only ever fail for the
    // reason the test names.
    expiresInSeconds: -3600,
    secret,
    issuer: localIssuer(),
  })

  return {
    name: 'expired-session',
    userId: USER_A.id,
    client: anonClient(),
    restSelect: (table, columns = '*') => restSelectWithToken(expired, table, columns),
  }
}

/** The three contexts that are always available, in a stable order. */
export async function alwaysAvailableContexts(): Promise<readonly AuthContext[]> {
  return [await validUserContext(), await secondUserContext(), unauthenticatedContext()]
}
