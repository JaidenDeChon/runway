import { describe, expect, it } from 'vitest'
import { toMinorUnits } from './money'
import {
  canPredict,
  DEFAULT_PREDICTION_WINDOW,
  isEstimating,
  MAX_PREDICTION_WINDOW,
  MIN_PREDICTION_WINDOW,
  predictAmount,
  recentHistory,
  resolveAmount,
  settledMagnitude,
} from './prediction'
import type { RecurringItem } from './types'

const income = (over: Partial<RecurringItem> = {}): RecurringItem => ({
  id: 'i',
  name: 'Paycheck',
  kind: 'income',
  amount: toMinorUnits(2000),
  cadence: 'biweekly',
  accountId: 'a',
  nextOccurrence: '2026-08-21',
  amountSource: 'predicted',
  depositHistory: [toMinorUnits(2440), toMinorUnits(2450), toMinorUnits(2460)],
  isVariable: false,
  ...over,
})

const variableBill = (over: Partial<RecurringItem> = {}): RecurringItem => ({
  ...income(),
  name: 'Electric & water',
  kind: 'bill',
  amount: toMinorUnits(120),
  amountSource: 'fixed',
  isVariable: true,
  depositHistory: [toMinorUnits(130), toMinorUnits(150)],
  ...over,
})

describe('predictAmount', () => {
  it('averages the deposit history', () => {
    expect(predictAmount(income().depositHistory)).toBe(toMinorUnits(2450))
  })

  it('rounds rather than truncating, so income is not biased downwards', () => {
    expect(predictAmount([100, 101])).toBe(101)
  })

  it('is zero with no history', () => {
    expect(predictAmount([])).toBe(0)
  })

  it('stays integer minor units for a mean that is not a whole cent', () => {
    const mean = predictAmount([100, 100, 101])
    expect(Number.isInteger(mean)).toBe(true)
    expect(mean).toBe(100)
  })
})

describe('canPredict', () => {
  it('needs more than a single deposit to mean anything', () => {
    expect(canPredict([])).toBe(false)
    expect(canPredict([toMinorUnits(100)])).toBe(false)
    expect(canPredict([toMinorUnits(100), toMinorUnits(120)])).toBe(true)
  })
})

describe('recentHistory — the rolling window', () => {
  const history = [1, 2, 3, 4, 5, 6].map((n) => toMinorUnits(n * 100))

  it('keeps the most recent `window` entries, still oldest first', () => {
    expect(recentHistory(history, 3)).toEqual([400, 500, 600].map(toMinorUnits))
  })

  it('defaults to DEFAULT_PREDICTION_WINDOW', () => {
    expect(DEFAULT_PREDICTION_WINDOW).toBe(3)
    expect(recentHistory(history)).toHaveLength(DEFAULT_PREDICTION_WINDOW)
  })

  it('returns everything when the history is shorter than the window', () => {
    expect(recentHistory(history.slice(0, 2), 5)).toEqual(history.slice(0, 2))
  })

  it('clamps a window outside the stored range rather than trusting it', () => {
    expect(recentHistory(history, 0)).toHaveLength(MIN_PREDICTION_WINDOW)
    expect(recentHistory(history, -4)).toHaveLength(MIN_PREDICTION_WINDOW)
    expect(recentHistory([...history, ...history, ...history], 99)).toHaveLength(
      MAX_PREDICTION_WINDOW,
    )
    expect(recentHistory(history, Number.NaN)).toHaveLength(DEFAULT_PREDICTION_WINDOW)
    expect(recentHistory(history, 2.9)).toHaveLength(2)
  })

  it('changes the estimate when the window changes — the setting is load-bearing', () => {
    const settled = [100, 100, 100, 400].map(toMinorUnits)
    expect(predictAmount(recentHistory(settled, 2))).toBe(toMinorUnits(250))
    expect(predictAmount(recentHistory(settled, 4))).toBe(toMinorUnits(175))
  })

  it('ages an outlier out after `window` cycles — the documented failure mode', () => {
    // A one-off bonus deposit pulls a mean of three by a third of its excess
    // for exactly three cycles, then is gone. This is the behaviour
    // docs/engine/README.md describes; a change here is a change to that.
    const withBonus = [2000, 2000, 5000].map(toMinorUnits)
    expect(predictAmount(recentHistory(withBonus, 3))).toBe(toMinorUnits(3000))
    const threeLater = [...withBonus, 2000, 2000, 2000].map(toMinorUnits)
    expect(predictAmount(recentHistory(threeLater, 3))).toBe(toMinorUnits(2000))
  })
})

describe('isEstimating', () => {
  it('is predicted income and variable bills, nothing else', () => {
    expect(isEstimating(income())).toBe(true)
    expect(isEstimating(income({ amountSource: 'fixed' }))).toBe(false)
    expect(isEstimating(variableBill())).toBe(true)
    expect(isEstimating(variableBill({ isVariable: false }))).toBe(false)
  })

  it('stays true with no history — a fallback figure is still not a certainty', () => {
    expect(isEstimating(income({ depositHistory: [] }))).toBe(true)
    expect(isEstimating(variableBill({ depositHistory: [] }))).toBe(true)
  })
})

describe('resolveAmount — zero, one and many settled occurrences', () => {
  it('zero: falls back to the stored amount without erroring', () => {
    expect(resolveAmount(income({ depositHistory: [] }))).toBe(toMinorUnits(2000))
  })

  it('one: still falls back — a single deposit is a copy, not an estimate', () => {
    expect(resolveAmount(income({ depositHistory: [toMinorUnits(2600)] }))).toBe(toMinorUnits(2000))
  })

  it('many: uses the mean for predicted income', () => {
    expect(resolveAmount(income())).toBe(toMinorUnits(2450))
  })

  it('applies the same mechanism to a variable bill', () => {
    expect(resolveAmount(variableBill())).toBe(toMinorUnits(140))
    expect(resolveAmount(variableBill({ depositHistory: [toMinorUnits(999)] }))).toBe(
      toMinorUnits(120),
    )
  })

  it('ignores history for fixed income and for bills that do not vary', () => {
    expect(resolveAmount(income({ amountSource: 'fixed' }))).toBe(toMinorUnits(2000))
    expect(resolveAmount(variableBill({ isVariable: false }))).toBe(toMinorUnits(120))
  })

  it('does not read the window itself — the caller has already applied it', () => {
    // Four entries average as four: windowing is `recentHistory`'s job, done
    // once where the user's setting is known (useRunwayData), not guessed here.
    const four = [100, 200, 300, 400].map(toMinorUnits)
    expect(resolveAmount(income({ depositHistory: four }))).toBe(toMinorUnits(250))
  })
})

describe('settledMagnitude', () => {
  it('turns a signed settled amount into the magnitude a rule holds', () => {
    expect(settledMagnitude('income', toMinorUnits(2450))).toBe(toMinorUnits(2450))
    expect(settledMagnitude('bill', toMinorUnits(-142))).toBe(toMinorUnits(142))
  })

  it('drops an amount whose sign contradicts the rule, or a zero', () => {
    expect(settledMagnitude('income', toMinorUnits(-50))).toBeNull()
    expect(settledMagnitude('bill', toMinorUnits(50))).toBeNull()
    expect(settledMagnitude('income', 0)).toBeNull()
  })
})
