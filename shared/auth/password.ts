/**
 * The password rule, in one place.
 *
 * It was written down twice — once on the sign-up form and once on the
 * password-reset form — and a rule stated twice is a rule that disagrees with
 * itself the first time somebody changes one. It is also stated a third time,
 * authoritatively, in `supabase/config.toml`: GoTrue is what actually accepts
 * or rejects a password, and a form that promises something looser produces a
 * rejection the user cannot act on.
 *
 * So the constant lives here, both forms import it, and
 * `tests/integration/auth-rate-limit.test.ts` holds it against
 * `minimum_password_length` in the config. Changing one without the other is a
 * red test rather than a confusing error on somebody's first sign-up.
 *
 * The client-side check is a courtesy, not a control: it saves a round trip and
 * says what the rule is before the user finds out the hard way. GoTrue remains
 * the authority, and a password this module would accept can still be refused.
 */

/** Mirrors `minimum_password_length` in `supabase/config.toml`. */
export const MINIMUM_PASSWORD_LENGTH = 8

/** What the form shows under the field. One sentence, stating the rule. */
export const PASSWORD_RULE_TEXT = `At least ${MINIMUM_PASSWORD_LENGTH} characters.`

/** True when a password is long enough to be worth sending. */
export function meetsPasswordRule(password: string): boolean {
  return password.length >= MINIMUM_PASSWORD_LENGTH
}
