/**
 * What the application knows about who is signed in.
 *
 * Deliberately small. Every screen needs an id and something to render in the
 * user menu; nothing downstream of here should ever need the token, and the
 * type makes that hard to reach for by accident. The id is the same value RLS
 * reads as `auth.uid()`, and it arrives from a *validated* session — never
 * from a request body, a query parameter, or anything else the client chose.
 */

/** Structural, so this module needs no `@supabase/supabase-js` import. */
export interface SupabaseUserLike {
  readonly id?: string | null
  readonly email?: string | null
  readonly user_metadata?: Record<string, unknown> | null | undefined
}

export interface AuthUser {
  /** `auth.users.id` — the value every `user_id` column must equal. */
  readonly id: string
  /** May be absent: a user can exist without a confirmed email address. */
  readonly email: string | null
  /** What the user menu shows. Never a balance, never a token. */
  readonly displayName: string
  /** One or two characters for the avatar fallback. */
  readonly initials: string
}

/** How much clock skew to tolerate before calling a session expired. */
export const EXPIRY_SKEW_SECONDS = 30

/**
 * Derives the display name from the metadata the user supplied, falling back to
 * the local part of their email and finally to a neutral word.
 *
 * The local part rather than the whole address on purpose: the sidebar renders
 * the full email underneath it already, and repeating it twice reads as a bug.
 */
export function displayNameFor(user: SupabaseUserLike): string {
  const metadataName = user.user_metadata?.full_name ?? user.user_metadata?.name
  if (typeof metadataName === 'string' && metadataName.trim()) return metadataName.trim()

  const email = typeof user.email === 'string' ? user.email.trim() : ''
  const localPart = email.split('@')[0] ?? ''
  if (localPart) return localPart

  return 'Your account'
}

/**
 * Up to two initials, taken from the display name's words.
 *
 * A single-word name yields one letter rather than two taken from inside it:
 * "Jordan" is J, not JO, because JO reads as two people.
 */
export function initialsFor(displayName: string): string {
  const words = displayName
    .split(/[\s._-]+/)
    .map((word) => word.trim())
    .filter(Boolean)

  if (words.length === 0) return '?'
  const first = words[0]?.[0] ?? ''
  const second = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : ''
  return (first + second).toUpperCase() || '?'
}

/**
 * Narrows what the auth provider returned into the shape the app carries, or
 * `null` when there is no usable identity.
 *
 * A user without an `id` is not a partially-valid user — it is the absence of
 * one, and returning `null` keeps every caller's check to `if (!user)`.
 */
export function toAuthUser(user: SupabaseUserLike | null | undefined): AuthUser | null {
  if (!user) return null
  const id = typeof user.id === 'string' ? user.id.trim() : ''
  if (!id) return null

  const email = typeof user.email === 'string' && user.email.trim() ? user.email.trim() : null
  const displayName = displayNameFor(user)
  return { id, email, displayName, initials: initialsFor(displayName) }
}

/**
 * Whether a session whose access token expires at `expiresAt` should be treated
 * as expired at `nowMs`.
 *
 * `expiresAt` is GoTrue's `session.expires_at`: **seconds** since the epoch, not
 * milliseconds. Mixing the two units is the bug this function exists to have
 * exactly one copy of.
 *
 * A missing or unparseable expiry counts as expired. The alternative — treating
 * "we do not know" as "still good" — is the failure mode that keeps a dead
 * session on screen until the first write fails.
 */
export function isSessionExpired(
  expiresAt: number | null | undefined,
  nowMs: number,
  skewSeconds: number = EXPIRY_SKEW_SECONDS,
): boolean {
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return true
  const nowSeconds = nowMs / 1000
  return expiresAt - skewSeconds <= nowSeconds
}
