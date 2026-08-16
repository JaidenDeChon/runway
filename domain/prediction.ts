/**
 * Predicting an income amount from deposit history.
 *
 * The product promise is "Runway uses this estimate until a real deposit
 * lands", so prediction is a stored figure that reality supersedes, not a
 * live-recomputed one: `predictAmount` is called when the item is saved and
 * again when a deposit is recorded, and the result is written into the item's
 * amount. Nothing re-derives it at render time.
 */

import type { MinorUnits } from './money'
import type { RecurringItem } from './types'

/** Below this, the mean is not worth showing as a prediction. */
export const MIN_DEPOSITS_FOR_PREDICTION = 2

/**
 * The arithmetic mean of a deposit history, in whole minor units.
 *
 * Rounds rather than truncates so a history of [100, 101] predicts 101 rather
 * than 100 — a systematic downward bias on income is exactly the wrong
 * direction to be wrong in for a runway forecast.
 */
export function predictAmount(history: readonly MinorUnits[]): MinorUnits {
  if (history.length === 0) return 0
  const total = history.reduce((sum, deposit) => sum + deposit, 0)
  return Math.round(total / history.length)
}

/** Whether there is enough history for "Predict from deposits" to mean anything. */
export function canPredict(history: readonly MinorUnits[]): boolean {
  return history.length >= MIN_DEPOSITS_FOR_PREDICTION
}

/**
 * The amount an item should store, honouring its `amountSource`.
 *
 * Falls back to the typed amount when a predicted item has too little history,
 * so switching the toggle can never silently zero out a real figure.
 */
export function resolveAmount(item: RecurringItem): MinorUnits {
  if (item.kind !== 'income' || item.amountSource !== 'predicted') return item.amount
  if (!canPredict(item.depositHistory)) return item.amount
  return predictAmount(item.depositHistory)
}

/**
 * Records a real deposit against a predicted income item.
 *
 * Appends to history *and* re-derives the amount in one step — the two must not
 * be separable, or an item can end up with history that its stored amount does
 * not reflect.
 */
export function recordDeposit(item: RecurringItem, deposit: MinorUnits): RecurringItem {
  const depositHistory = [...item.depositHistory, deposit]
  const next: RecurringItem = { ...item, depositHistory }
  return { ...next, amount: resolveAmount(next) }
}
