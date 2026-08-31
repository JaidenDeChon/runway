/**
 * The money field's draft string, as pure functions.
 *
 * `MoneyInput` binds in integer minor units, but between two keystrokes it has
 * to hold something that is not yet a number — `"12."`, `"-"`, an empty field.
 * That half-typed string is the state, and every rule about it lives here
 * rather than inside the component, for the same reason `burndown.ts` exists:
 * a parse that is an expression inside an event handler is a parse that cannot
 * be tested, and this one has to get signs, pasted currency and `-0` right.
 *
 * **The sign lives in the draft string, not beside it.** The field is
 * `type="text"` precisely so that it can: `type="number"` blanks its own value
 * on a partial like `"-"`, so a lone minus could never be typed and then
 * completed. Keeping the sign in the one string means the keyboard and the
 * sign toggle are edits to the same thing and cannot disagree.
 *
 * Pure TypeScript, no Vue imports, so it runs under the `unit` test project
 * alongside `format.ts` and `burndown.ts`.
 */

import { MINUS } from '@/lib/format'
import type { MinorUnits } from '~~/domain/money'
import { toMajorUnits, toMinorUnits } from '~~/domain/money'

/** A leading sign, in either the keyboard's hyphen-minus or the one we render. */
const LEADING_SIGN = new RegExp(`^\\s*[-${MINUS}]`)

/** Every sign character anywhere, for stripping. */
const ANY_SIGN = new RegExp(`[-${MINUS}]`, 'g')

/** Anything that is not a digit or a decimal point, once the sign is off. */
const NOT_NUMERIC = /[^0-9.]/g

/** The draft for a stored amount. `-123456` → `"-1234.56"`. */
export function draftFor(value: MinorUnits): string {
  return String(toMajorUnits(value))
}

/**
 * The stored amount a draft means. Anything unparseable is `0`, matching the
 * design's "non-numeric entry coerces to 0" rule.
 *
 * `|| 0` is not redundant: `toMinorUnits(-0)` is `-0`, which would travel all
 * the way to `balance_cents` as a signed zero and render through a sign check
 * as the wrong thing. A zero balance has no sign.
 */
export function draftValue(draft: string): MinorUnits {
  const parsed = Number(draft)
  if (!Number.isFinite(parsed)) return 0
  return toMinorUnits(parsed) || 0
}

/** Whether a draft is currently negative — what the sign toggle reads. */
export function isNegative(draft: string): boolean {
  return LEADING_SIGN.test(draft)
}

/**
 * Normalizes what the user typed or pasted into a draft.
 *
 * Pasting `"-$1,234.56"` out of a bank statement is the case this exists for:
 * the currency symbol, the thousands separators and the surrounding space are
 * all dropped, and a typographic minus counts as a minus. A second decimal
 * point is folded in rather than truncating the entry, so `"1.2.3"` becomes
 * `"1.23"` instead of silently losing the cents.
 *
 * With `allowNegative` off the sign is discarded and the magnitude kept — the
 * field the user is in cannot hold a negative (a safety cushion, a bill's
 * positive magnitude), and reading `-50` as `0` would throw away digits they
 * did type.
 */
export function sanitize(typed: string | number, allowNegative: boolean): string {
  const raw = String(typed)
  const negative = allowNegative && isNegative(raw)
  const digits = raw.replace(ANY_SIGN, '').replace(NOT_NUMERIC, '')
  const [whole = '', ...rest] = digits.split('.')
  const magnitude = rest.length > 0 ? `${whole}.${rest.join('')}` : whole
  return negative ? `-${magnitude}` : magnitude
}

/**
 * The same draft, forced to a sign. This is the sign toggle's whole
 * implementation.
 *
 * Toggling an empty field to negative leaves a bare `"-"`, which is worth
 * nothing (`draftValue` reads it as `0`) and is exactly right: the user has
 * said "negative" before saying how much, and the digits they type next land
 * after it.
 */
export function withSign(draft: string, negative: boolean): string {
  const magnitude = draft.replace(LEADING_SIGN, '')
  return negative ? `-${magnitude}` : magnitude
}
