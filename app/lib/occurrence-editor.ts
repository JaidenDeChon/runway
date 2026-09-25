/**
 * Pure copy builders and payload types for `DayDetailEditor.vue` (issue #15).
 *
 * No arithmetic on balances here — `splitConsequence` only ever formats
 * dates and an amount that arrived already resolved. Kept out of the
 * component so the copy is under unit test and date arithmetic stays out of
 * the template, matching `app/lib/shortfall-target.ts`'s own reasoning for
 * living outside its screen.
 */

import type { IsoDate } from '~~/domain/dates'
import { addDays, compareDates, minDate } from '~~/domain/dates'
import type { MinorUnits } from '~~/domain/money'
import type { OverrideScope } from '~~/domain/overrides'
import type { Occurrence } from '~~/domain/projection'
import { isEstimated } from '~~/domain/projection'
import type { Cadence } from '~~/domain/types'
import { formatDateShort, formatMoney } from './format'

/** The payload `DayDetailEditor.vue` emits on `save`. */
export interface OccurrenceEdit {
  readonly itemId: string
  /** The occurrence's projected date — the half of `occurrences`' natural key that never moves. */
  readonly date: IsoDate
  readonly scope: OverrideScope
  /** Signed, matching `Occurrence.amount`. */
  readonly amount: MinorUnits
  /** `once` only; omitted when the date is unchanged. */
  readonly newDate?: IsoDate
  /** The rule's own signed amount for this date, for the insert branch of `override_occurrence`. */
  readonly projectedAmount: MinorUnits
}

/** The payload `DayDetailEditor.vue` emits on `revert`. */
export interface OccurrenceRevert {
  readonly itemId: string
  readonly date: IsoDate
}

/** How often a rule repeats, worked into the consequence sentence below. */
const CADENCE_ADVERB: Record<Cadence, string> = {
  weekly: 'each week',
  biweekly: 'every two weeks',
  monthly: 'each month',
  annual: 'each year',
}

/**
 * The sentence shown under "Apply to all future" before it is pressed:
 * "Every Rent from Sep 1 becomes $1,750 each month. The current schedule
 * closes Aug 31; past occurrences are kept."
 *
 * States the consequence in words rather than leaving it as a silent
 * side effect of pressing a button — apply-to-future closes the existing
 * rule and opens a successor (docs/database/schema.md § "Rule splitting"),
 * and that is not guessable from a toggle alone.
 */
export function splitConsequence(input: {
  readonly label: string
  readonly cadence: Cadence
  readonly effectiveFrom: IsoDate
  readonly amount: MinorUnits
  /**
   * Issue #18: the rule is estimated (predicted income or a variable bill).
   * `split_recurring_rule` pins the new schedule to the amount given, so the
   * sentence has to say the estimate stops — it is not guessable otherwise.
   */
  readonly estimating?: boolean
}): string {
  const closesOn = addDays(input.effectiveFrom, -1)
  return (
    `Every ${input.label} from ${formatDateShort(input.effectiveFrom)} becomes ` +
    `${formatMoney(input.amount)} ${CADENCE_ADVERB[input.cadence]}. The current schedule closes ` +
    `${formatDateShort(closesOn)}; past occurrences are kept.` +
    (input.estimating ? ' From then on this is a fixed amount, no longer estimated.' : '')
  )
}

/**
 * The one-line summary shown for an already-overridden occurrence: "Rule
 * value: $310 on Aug 20." — what "Revert to rule value" restores.
 */
export function overrideSummary(input: {
  readonly projectedAmount: MinorUnits
  readonly projectedDate: IsoDate
}): string {
  return `Rule value: ${formatMoney(input.projectedAmount)} on ${formatDateShort(input.projectedDate)}`
}

/**
 * The identity of one occurrence, as a string a `Map` or `Set` can key on.
 *
 * `(itemId, projectedDate)` is `occurrences`' natural key and the only half of
 * an occurrence that survives a retime — the same pair `OccurrenceEdit.date`
 * and `OccurrenceRevert.date` carry, and deliberately not `Occurrence.id`,
 * which `applyOne` rewrites the moment an override lands on it. A row keyed on
 * `id` remounts on every edit; a row keyed on this one keeps its draft, its
 * focus and its place.
 */
export function occurrenceKey(itemId: string, date: IsoDate): string {
  return `${itemId}@${date}`
}

/**
 * The payload `DayDetailEditor.vue` emits on `settle` — "Mark as paid" /
 * "Mark as received", issue #26's manual half. Keyed like `OccurrenceEdit`
 * (`date` is the projected date, the natural key); `actualDate` is when it
 * really happened and is always present.
 */
export interface OccurrenceSettlement {
  readonly itemId: string
  readonly date: IsoDate
  /** Signed, matching `Occurrence.amount`: what actually landed. */
  readonly amount: MinorUnits
  readonly projectedAmount: MinorUnits
  readonly actualDate: IsoDate
}

/**
 * Money in is "received", money out is "paid". Read from the sign of the
 * rule's own amount for the date, which `signedAmount` derives from the
 * rule's kind and which is never zero.
 */
export function settledWord(projectedAmount: MinorUnits): 'Paid' | 'Received' {
  return projectedAmount > 0 ? 'Received' : 'Paid'
}

/**
 * The day a settlement records. What the form says, unless that is still in
 * the future: nothing has happened on a day that has not arrived, so a bill
 * paid ahead of its due date is recorded as paid today. The button says so
 * (`settleLabel`), so this is never a silent substitution.
 */
export function settlementDate(formDate: IsoDate, today: IsoDate): IsoDate {
  return minDate(formDate, today)
}

/** "Mark as paid", "Mark as received today", … — the settle button's text. */
export function settleLabel(input: {
  readonly projectedAmount: MinorUnits
  readonly formDate: IsoDate
  readonly today: IsoDate
}): string {
  const verb = settledWord(input.projectedAmount).toLowerCase()
  return compareDates(input.formDate, input.today) > 0 ? `Mark as ${verb} today` : `Mark as ${verb}`
}

/**
 * Why the amount in the form cannot be recorded as settled, or `null` when it
 * can. The only thing checked is the sign — a bill is paid as a negative
 * amount, income arrives as a positive one — because `settle_occurrence`
 * refuses anything else, and a disabled button with a reason beats a failed
 * save with none. A comparison of signs, not arithmetic on money.
 */
export function settlementProblem(input: {
  readonly amount: MinorUnits
  readonly projectedAmount: MinorUnits
}): string | null {
  if (input.projectedAmount < 0 && input.amount >= 0) {
    return 'A bill is recorded as a negative amount.'
  }
  if (input.projectedAmount > 0 && input.amount <= 0) {
    return 'Income is recorded as a positive amount.'
  }
  return null
}

/**
 * The settled panel's detail line: "Planned: $310 on Aug 20." — what the
 * schedule said, beside what happened, which is the comparison anyone looking
 * at a settled bill is making.
 */
export function plannedSummary(input: {
  readonly projectedAmount: MinorUnits
  readonly projectedDate: IsoDate
}): string {
  return `Planned: ${formatMoney(input.projectedAmount)} on ${formatDateShort(input.projectedDate)}`
}

/**
 * The parenthetical the chart's tooltip and its live announcement put after
 * an occurrence's label, or `''`. One precedence for both, so the spoken and
 * the drawn tooltip cannot disagree: what happened (`paid` / `received`,
 * #26), then the user's own figure (`edited`, #15), then an estimate (#18).
 */
export function occurrenceQualifier(occurrence: Occurrence): string {
  if (occurrence.isSettled) return `(${settledWord(occurrence.projectedAmount).toLowerCase()})`
  if (occurrence.isOverridden) return '(edited)'
  if (isEstimated(occurrence)) return '(estimated)'
  return ''
}
