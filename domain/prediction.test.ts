import { describe, expect, it } from 'vitest'
import { toMinorUnits } from './money'
import { canPredict, predictAmount, recordDeposit, resolveAmount } from './prediction'
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
})

describe('canPredict', () => {
  it('needs more than a single deposit to mean anything', () => {
    expect(canPredict([])).toBe(false)
    expect(canPredict([toMinorUnits(100)])).toBe(false)
    expect(canPredict([toMinorUnits(100), toMinorUnits(120)])).toBe(true)
  })
})

describe('resolveAmount', () => {
  it('uses the mean for predicted income', () => {
    expect(resolveAmount(income())).toBe(toMinorUnits(2450))
  })

  it('keeps the typed amount when there is too little history', () => {
    // Flipping the toggle must never silently zero out a real figure.
    expect(resolveAmount(income({ depositHistory: [] }))).toBe(toMinorUnits(2000))
  })

  it('ignores prediction for fixed income and for bills', () => {
    expect(resolveAmount(income({ amountSource: 'fixed' }))).toBe(toMinorUnits(2000))
    expect(resolveAmount(income({ kind: 'bill' }))).toBe(toMinorUnits(2000))
  })
})

describe('recordDeposit', () => {
  it('appends history and re-derives the amount together', () => {
    const result = recordDeposit(income(), toMinorUnits(2650))
    expect(result.depositHistory).toHaveLength(4)
    expect(result.amount).toBe(toMinorUnits(2500))
  })

  it('leaves the amount of a fixed item alone', () => {
    const result = recordDeposit(income({ amountSource: 'fixed' }), toMinorUnits(9999))
    expect(result.amount).toBe(toMinorUnits(2000))
  })
})
