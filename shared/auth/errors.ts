/**
 * What the user is told when authentication fails.
 *
 * The issue's words: "Error messages state what went wrong without revealing
 * whether an email is registered." That is not a copywriting note — it is the
 * whole security property of this file, and it is easy to lose one careless
 * `error.message` at a time. So the mapping lives here, in one pure function,
 * with a unit test that names the leak it is preventing.
 *
 * Four rules:
 *
 * 1. **Never pass a provider message straight through.** GoTrue is helpful in
 *    ways we cannot afford: "User already registered" answers, for anybody with
 *    a form and a word list, the question "does this person bank here".
 * 2. **The same outcome gets the same words.** Sign-up and password reset
 *    return one neutral acknowledgement whether or not the address exists, so
 *    the *response* carries no signal either.
 * 3. **Say what to do next.** A message that reveals nothing and helps nobody
 *    is not a win; every string below ends with an action.
 * 4. **The same words get the same tone.** Issue #89: this file got rules 1-3
 *    right and still leaked — a registered address rendered its neutral words
 *    in a destructive red box, an unregistered one in a plain notice, because
 *    the tone was computed separately from the message and only the message
 *    was neutralised. Identical copy in two different-looking boxes is still
 *    two different outcomes to a screen or an eye. `authErrorResult` below is
 *    what makes that impossible by construction: it is the one function that
 *    decides both, so there is no second call site where they can disagree.
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
 * The neutral acknowledgement `operation` falls through to on a masked
 * failure, or `null` when it has none.
 *
 * The one place that decides *which* operations are anti-enumeration
 * operations. `authErrorMessage` and `authErrorResult` below both call this
 * rather than each carrying their own copy of the same three-way check — a
 * second copy is exactly how issue #89 happened: the message half of this
 * file was already masked correctly, and the tone half re-derived "which
 * operations count" independently, so the two silently disagreed. A single
 * function means a future operation added here is masked *and* toned
 * correctly the moment it is added, not after someone remembers to update
 * two places.
 */
function neutralAcknowledgementFor(operation: AuthOperation): string | null {
  if (operation === 'sign-up') return NEUTRAL_SIGN_UP_SENT
  if (operation === 'magic-link' || operation === 'password-reset-request')
    return NEUTRAL_EMAIL_SENT
  return null
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

  const neutral = neutralAcknowledgementFor(operation)
  if (neutral !== null) return neutral

  const safe = SAFE_CODES[code]
  if (safe) return safe

  // A message we did not anticipate is never shown verbatim: it might be the
  // one that names the account.
  return GENERIC[operation]
}

/**
 * Masked codes that are a routine, expected business outcome rather than a
 * system or delivery problem.
 *
 * `user_already_exists`, confirmed against the real local GoTrue: signing up
 * with an address that already has an account is completely ordinary
 * behaviour — someone forgot, or is testing the form — not a broken mailer.
 * `authErrorResult.loggable` exists because logging every one of these at
 * the same severity as a genuine send failure would bury the incidents that
 * logging is for (issue #89's AC4) under routine traffic — a busy sign-up
 * form could produce more of these in an hour than a real SMTP outage does
 * in a week.
 *
 * Deliberately narrow — this excludes the one code verified to be routine
 * rather than trying to classify GoTrue's whole error taxonomy; a code this
 * set does not name defaults to loggable. An unregistered address on
 * `password-reset-request` never needs an entry here at all: verified
 * directly against the local stack, GoTrue does not attempt delivery for an
 * address it does not know, so that call returns no error in the first
 * place — never reaching `authErrorResult`, let alone getting logged.
 */
const ROUTINE_MASKED_CODES = new Set(['user_already_exists'])

/** The message, the tone, and whether a masked failure is worth logging — decided together. */
export interface AuthErrorResult {
  readonly message: string
  readonly tone: 'error' | 'notice'
  /**
   * Whether a caller should log this outcome for an operator to see. Only
   * ever `false` for a masked (`tone: 'notice'`) failure whose code is a
   * confirmed-routine one; a real, surfaced (`tone: 'error'`) failure is
   * already visible to the user, so callers today only consult this when
   * `tone === 'notice'` — the value is still defined either way, so it never
   * needs a caller to duplicate the tone check before reading it.
   */
  readonly loggable: boolean
}

/**
 * The full outcome of a failed auth call — issue #89's fix, and rule 4 above
 * made structural. `authErrorMessage` is this function's `message` half,
 * still exported on its own because most of this file's tests, and every
 * caller from before #89, only ever wanted the words; nothing about that
 * changes here.
 *
 * The tone follows the message, not the error: whenever `message` turns out
 * to be the operation's own neutral acknowledgement — `sign-up` masked to
 * `NEUTRAL_SIGN_UP_SENT`, or `magic-link`/`password-reset-request` masked to
 * `NEUTRAL_EMAIL_SENT` — the tone is `'notice'`, the same tone the success
 * path already uses for that exact sentence. A caller showing this result
 * cannot render a registered address in red and an unregistered one in grey,
 * because there is no code path in which the two differ.
 *
 * Rate limiting keeps its `'error'` tone here, correctly: it is a safe-code
 * message (`over_email_send_rate_limit`, …), never the neutral
 * acknowledgement, so the check below never matches it — the same exception
 * `authErrorMessage`'s own doc comment already names, applied consistently.
 *
 * `neutralAcknowledgementFor` is what `authErrorMessage` itself consults for
 * the same question, so this cannot re-derive "which operations count" and
 * quietly disagree with the message half the way the first version of this
 * fix did.
 */
export function authErrorResult(
  operation: AuthOperation,
  error: AuthErrorLike | null | undefined,
): AuthErrorResult {
  const message = authErrorMessage(operation, error)
  const neutral = neutralAcknowledgementFor(operation)
  const tone = neutral !== null && message === neutral ? 'notice' : 'error'
  const code = typeof error?.code === 'string' ? error.code : null
  const loggable = !(code !== null && ROUTINE_MASKED_CODES.has(code))
  return { message, tone, loggable }
}
