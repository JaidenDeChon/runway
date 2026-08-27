/**
 * Minting local-stack JWTs, for the one auth context that cannot be obtained by
 * signing in: an expired session.
 *
 * Issue #5 requires auth helpers covering "valid user, second user,
 * unauthenticated, expired session". The first three come straight from GoTrue.
 * The fourth cannot: local `jwt_expiry` is an hour, and a test suite is not
 * going to wait. The only honest way to hold an expired token is to sign one,
 * which means holding the local stack's signing secret.
 *
 * That secret is a fixed, published constant of the Supabase CLI's local
 * development stack. It is worth exactly nothing outside a developer's own
 * machine, it is not a credential for anything, and it is never read from or
 * written to `.env`. It is also never logged: `describeSecretAvailability()`
 * exists so a skip message can explain itself without printing the value.
 *
 * If the secret cannot be resolved, the affected tests skip loudly rather than
 * asserting something weaker and calling it the same thing.
 */

import { createHmac, randomUUID } from 'node:crypto'
import { requireStack } from './database'

/**
 * The Supabase CLI's local-development JWT secret.
 *
 * Only used when `supabase status` does not report `JWT_SECRET` — CLI output
 * has moved between versions. Any value found this way is *verified* before it
 * is trusted, by `assertSecretSigns` below, so a wrong guess degrades to a skip
 * and never to a false pass.
 */
const CLI_LOCAL_JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long'

function base64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export interface MintOptions {
  readonly userId: string
  readonly email?: string
  /**
   * Seconds from now until `exp`. Negative mints an already-expired token,
   * which is the whole point of this module.
   */
  readonly expiresInSeconds: number
  readonly secret: string
  readonly issuer: string
}

/** An HS256 JWT shaped the way GoTrue shapes one, so PostgREST reads it the same. */
export function mintAccessToken(options: MintOptions): string {
  const issuedAt = Math.floor(Date.now() / 1000)
  const header = { alg: 'HS256', typ: 'JWT' }
  const payload = {
    aud: 'authenticated',
    role: 'authenticated',
    iss: options.issuer,
    sub: options.userId,
    email: options.email ?? '',
    phone: '',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    aal: 'aal1',
    session_id: randomUUID(),
    is_anonymous: false,
    iat: issuedAt,
    exp: issuedAt + options.expiresInSeconds,
  }

  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`
  const signature = base64Url(createHmac('sha256', options.secret).update(signingInput).digest())
  return `${signingInput}.${signature}`
}

/** The `iss` claim GoTrue uses on this stack. */
export function localIssuer(): string {
  return `${requireStack().apiUrl.replace(/\/$/, '')}/auth/v1`
}

/**
 * The signing secret to use, or `null` when none is available.
 *
 * Never returns a value it has not seen work — see `resolveVerifiedJwtSecret`.
 */
export function candidateJwtSecrets(): readonly string[] {
  const reported = requireStack().jwtSecret
  return reported ? [reported, CLI_LOCAL_JWT_SECRET] : [CLI_LOCAL_JWT_SECRET]
}

/**
 * A secret proven to produce tokens this stack accepts, or `null`.
 *
 * `probe` is supplied by the caller (it needs a live HTTP round trip, which
 * this module has no business owning): it receives a freshly minted *valid*
 * token and reports whether the API accepted it. Only a secret that passes
 * that check is returned, so an expired-token assertion can never pass for the
 * wrong reason — a token rejected because it was signed with the wrong key
 * looks identical to one rejected for being expired.
 */
export async function resolveVerifiedJwtSecret(
  userId: string,
  probe: (token: string) => Promise<boolean>,
): Promise<string | null> {
  for (const secret of candidateJwtSecrets()) {
    const valid = mintAccessToken({
      userId,
      expiresInSeconds: 300,
      secret,
      issuer: localIssuer(),
    })
    if (await probe(valid)) return secret
  }
  return null
}

/** A human-readable statement about availability that never prints the secret. */
export function describeSecretAvailability(): string {
  return requireStack().jwtSecret
    ? '`supabase status` reported a JWT secret, but tokens signed with it were rejected'
    : '`supabase status` did not report JWT_SECRET and the CLI default did not verify'
}
