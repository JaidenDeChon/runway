/**
 * Estimating a recurring amount from its own settled history — issue #18.
 *
 * Two kinds of rule are estimated, by the same mechanism:
 *
 * - income whose `amountSource` is `'predicted'` ("Predict from deposits");
 * - a bill flagged `isVariable` ("Amount varies each cycle").
 *
 * The estimate is the **rounded arithmetic mean of the rule's most recent
 * settled amounts**, at most `prediction_window` of them (default
 * `DEFAULT_PREDICTION_WINDOW`). With fewer than `MIN_DEPOSITS_FOR_PREDICTION`
 * settled amounts there is nothing worth calling an estimate, and the rule's
 * own stored `amount` is used instead — the "fixed amount" the issue says to
 * fall back to.
 *
 * **Live, not stored.** `resolveAmount` runs wherever the engine needs a
 * rule's amount (`projection.ts` `signedAmount`), so the stored `amount` stays
 * the user's own figure and remains available as the fallback. Freezing the
 * mean into `amount` at save time — what the design export did, and what this
 * module did before #18 — destroys that fallback the first time it runs, and
 * leaves the stored figure stale the moment a new settled amount lands
 * (docs/design/recurring-items/spec.md open question 7).
 *
 * **The known failure mode is an outlier.** A plain mean is pulled by one
 * unusual deposit — a bonus, a partial final paycheck, a winter heating bill —
 * by `outlier / window` for as long as that deposit is inside the window, and
 * then not at all. The rolling window is what bounds it: with the default of
 * 3, a one-off stays in the estimate for exactly three cycles. A median would
 * ignore a single outlier outright, but it also ignores a genuine step change
 * (a raise) until it is the majority of the window, and the design specifies
 * a mean. Anomaly detection, trend fitting and seasonality are out of scope
 * for #18. See docs/engine/README.md, "Estimated amounts".
 *
 * Pure: the window is applied to whatever history the caller hands over, and
 * the caller (`useRunwayData`) is where the user's setting comes from.
 */

import type { MinorUnits } from './money'
import type { RecurringItem, RecurringKind } from './types'

/** Below this many settled amounts, the mean is not worth showing as an estimate. */
export const MIN_DEPOSITS_FOR_PREDICTION = 2

/**
 * How many recent settled amounts an estimate averages, unless the user has
 * chosen otherwise. Mirrors `user_settings.prediction_window`'s default — the
 * "last 3 deposits" of the design's own copy.
 */
export const DEFAULT_PREDICTION_WINDOW = 3

/** Bounds of `user_settings.prediction_window` (its check constraint). */
export const MIN_PREDICTION_WINDOW = MIN_DEPOSITS_FOR_PREDICTION
export const MAX_PREDICTION_WINDOW = 12

/**
 * The most recent `window` entries of an oldest-first history, still oldest
 * first. A window outside `[MIN_PREDICTION_WINDOW, MAX_PREDICTION_WINDOW]`, or
 * not a whole number, is clamped into it rather than trusted — the database
 * enforces the same range, and this keeps a malformed value from producing a
 * zero- or negative-length slice.
 */
export function recentHistory(
  history: readonly MinorUnits[],
  window: number = DEFAULT_PREDICTION_WINDOW,
): MinorUnits[] {
  const size = Number.isFinite(window)
    ? Math.min(MAX_PREDICTION_WINDOW, Math.max(MIN_PREDICTION_WINDOW, Math.trunc(window)))
    : DEFAULT_PREDICTION_WINDOW
  return history.slice(-size)
}

/**
 * The arithmetic mean of a history, in whole minor units.
 *
 * Rounds rather than truncates so a history of [100, 101] predicts 101 rather
 * than 100 — a systematic downward bias on income is exactly the wrong
 * direction to be wrong in for a runway forecast. For a bill, rounding half up
 * errs towards the larger bill, which is the same direction of caution.
 */
export function predictAmount(history: readonly MinorUnits[]): MinorUnits {
  if (history.length === 0) return 0
  const total = history.reduce((sum, deposit) => sum + deposit, 0)
  return Math.round(total / history.length)
}

/** Whether there is enough history for an estimate to mean anything. */
export function canPredict(history: readonly MinorUnits[]): boolean {
  return history.length >= MIN_DEPOSITS_FOR_PREDICTION
}

/**
 * Whether this rule's amount is an estimate rather than a figure the user
 * stated: predicted income, or a variable bill. True even while history is
 * too thin to estimate from — the fallback amount of an item the user said
 * varies is still not a certainty, and presenting it as one is exactly what
 * the issue forbids.
 */
export function isEstimating(item: RecurringItem): boolean {
  return item.kind === 'income' ? item.amountSource === 'predicted' : item.isVariable
}

/**
 * The amount the engine should use for this rule: the mean of its settled
 * history when it is estimated and has enough of it, otherwise its own stored
 * amount. Never zero for a valid rule — the stored amount is `> 0` by
 * constraint, and so is every settled magnitude `settledMagnitude` admits.
 */
export function resolveAmount(item: RecurringItem): MinorUnits {
  if (!isEstimating(item)) return item.amount
  if (!canPredict(item.depositHistory)) return item.amount
  return predictAmount(item.depositHistory)
}

/**
 * A settled occurrence's signed `actual_amount_cents`, as the positive
 * magnitude `depositHistory` holds — or `null` when it cannot be one.
 *
 * Occurrence amounts are signed (income positive, bills negative, matching
 * `projection.ts` `signedAmount`), rule amounts are magnitudes. A settled
 * amount whose sign contradicts its rule's kind, or that is zero, is not a
 * deposit or a bill payment this rule could have produced — a missed cycle is
 * recorded as `status = 'skipped'`, not as a zero — so it is dropped rather
 * than allowed to drag an estimate towards zero or below it.
 */
export function settledMagnitude(kind: RecurringKind, signedActual: MinorUnits): MinorUnits | null {
  const magnitude = kind === 'income' ? signedActual : -signedActual
  return magnitude > 0 ? magnitude : null
}
