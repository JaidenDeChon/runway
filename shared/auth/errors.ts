/**
 * What the user is told when authentication fails.
 *
 * The issue's words: "Error messages state what went wrong without revealing
 * whether an email is registered." That is not a copywriting note — it is the
 * whole security property of this file, and it is easy to lose one careless
 * `error.message` at a time. So the mapping lives here, in one pure function,
 * with a unit test that names the leak it is preventing.
 *
 * Three rules:
 *
 * 1. **Never pass a provider message straight through.** GoTrue is helpful in
 *    ways we cannot afford: "User already registered" answers, for anybody with
 *    a form and a word list, the question "does this person bank here".
 * 2. **The same outcome gets the same words.** Sign-up and password reset
 *    return one neutral acknowledgement whether or not the address exists, so
 *    the *response* carries no signal either.
 * 3. **Say what to do next.** A message that reveals nothing and helps nobody
 *    is not a win; every string below ends with an action.
 */

import { PASSWORD_RULE_TEXT } from './password'

/** The shape of the error `supabase-js` hands back. Structural, so tests need no library. */
export interface AuthErrorLike {
  readonly message?: string
  readonly code?: string
  readonly status?: number
}

/** The operation being attempted, which decides how much may safely be said. */
export type AuthOperation =
  | 'sign-in'
  | 'sign-up'
  | 'magic-link'
  | 'password-reset-request'
  | 'password-update'
  | 'sign-out'

/**
 * Neutral acknowledgements for the operations that must not confirm or deny
 * that an address is registered. These are returned on *success* too — see
 * the note in each page — so the two cases are indistinguishable.
 */
export const NEUTRAL_EMAIL_SENT =
  'If that email address has an account, a link is on its way. Check your inbox.'

export const NEUTRAL_SIGN_UP_SENT =
  'Check your inbox — if we could create the account, a confirmation link is on its way.'

const GENERIC: Record<AuthOperation, string> = {
  'sign-in': 'Something went wrong signing in. Try again in a moment.',
  'sign-up': 'Something went wrong creating the account. Try again in a moment.',
  'magic-link': 'Something went wrong sending the link. Try again in a moment.',
  'password-reset-request': 'Something went wrong sending the link. Try again in a moment.',
  'password-update': 'Something went wrong saving the new password. Try again in a moment.',
  'sign-out': 'Something went wrong signing out. Try again in a moment.',
}

/**
 * Codes that describe the *request*, not the account, and so are safe to
 * reflect. Each is a fact the caller already knows — they typed the password,
 * they clicked the link, they pressed the button four times.
 */
const SAFE_CODES: Record<string, string> = {
  // The one message that must stay identical for "no such user" and "wrong
  // password". GoTrue already conflates them; this keeps it that way.
  invalid_credentials: 'That email and password do not match. Check them and try again.',
  weak_password: `That password is too weak. ${PASSWORD_RULE_TEXT}`,
  same_password: 'That is already your password. Choose a different one.',
  over_request_rate_limit: 'Too many attempts. Wait a minute and try again.',
  over_email_send_rate_limit: 'Too many emails requested. Wait a few minutes and try again.',
  otp_expired: 'That link has expired. Request a new one.',
  validation_failed: 'Check the details you entered and try again.',
  email_address_invalid: 'That does not look like an email address.',
  session_expired: 'Your session has expired. Sign in again.',
  refresh_token_not_found: 'Your session has expired. Sign in again.',
  refresh_token_already_used: 'Your session has expired. Sign in again.',
}

/**
 * Substrings of provider messages that indicate the address is already
 * registered. Matching them is how we make sure we *do not* repeat them.
 */
const ENUMERATING_FRAGMENTS = [
  'already registered',
  'already been registered',
  'user already exists',
  'email address is already',
]

/** True when a provider message would disclose whether an address has an account. */
export function revealsRegistration(message: string | undefined): boolean {
  if (!message) return false
  const lowered = message.toLowerCase()
  return ENUMERATING_FRAGMENTS.some((fragment) => lowered.includes(fragment))
}

/**
 * The message to show the user for a failed auth call.
 *
 * `sign-up` and `password-reset-request` never surface a failure that would
 * distinguish a registered address from an unregistered one: they fall through
 * to the same neutral acknowledgement the success path shows. Rate limiting is
 * the deliberate exception — it is a fact about this browser, not about any
 * account, and hiding it would leave the user pressing a dead button.
 */
export function authErrorMessage(
  operation: AuthOperation,
  error: AuthErrorLike | null | undefined,
): string {
  if (!error) return GENERIC[operation]

  const code = typeof error.code === 'string' ? error.code : ''
  const rateLimited =
    code === 'over_request_rate_limit' ||
    code === 'over_email_send_rate_limit' ||
    error.status === 429

  if (rateLimited) {
    return SAFE_CODES[code] ?? 'Too many attempts. Wait a minute and try again.'
  }

  if (operation === 'sign-up') return NEUTRAL_SIGN_UP_SENT
  if (operation === 'magic-link' || operation === 'password-reset-request')
    return NEUTRAL_EMAIL_SENT

  const safe = SAFE_CODES[code]
  if (safe) return safe

  // A message we did not anticipate is never shown verbatim: it might be the
  // one that names the account.
  return GENERIC[operation]
}
