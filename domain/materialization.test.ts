import { describe, expect, it } from 'vitest'
import { occurrenceDates } from './cadence'
import {
  desiredOccurrences,
  MATERIALIZATION_HORIZON_DAYS,
  MATERIALIZATION_LOOKBACK_DAYS,
  materializationWindow,
} from './materialization'
import { toMinorUnits } from './money'
import type { RecurringItem } from './types'

const item = (over: Partial<RecurringItem> = {}): RecurringItem => ({
  id: 'i',
  name: 'Item',
  kind: 'bill',
  amount: toMinorUnits(100),
  cadence: 'monthly',
  accountId: 'a',
  nextOccurrence: '2026-08-20',
  amountSource: 'fixed',
  depositHistory: [],
  isVariable: false,
  ...over,
})

describe('materializationWindow', () => {
  it('spans 90 days back to 365 days forward from today', () => {
    expect(materializationWindow('2026-09-03')).toEqual({
      start: '2026-06-05',
      end: '2027-09-03',
    })
  })

  it('uses the exported constants, not hardcoded numbers', () => {
    expect(MATERIALIZATION_LOOKBACK_DAYS).toBe(90)
    expect(MATERIALIZATION_HORIZON_DAYS).toBe(365)
  })
})

describe('desiredOccurrences', () => {
  it('matches occurrenceDates exactly for a single rule', () => {
    const rule = item({ id: 'rent', nextOccurrence: '2026-08-20' })
    const window = { start: '2026-08-01', end: '2026-11-30' }

    expect(desiredOccurrences([rule], window)).toEqual(
      occurrenceDates(rule, window.start, window.end).map((date) => ({
        ruleId: 'rent',
        date,
        amount: toMinorUnits(-100),
      })),
    )
  })

  it('signs the amount like projection.ts signedAmount: income positive, bills negative', () => {
    const bill = item({ id: 'bill', kind: 'bill', amount: toMinorUnits(50) })
    const income = item({ id: 'pay', kind: 'income', amount: toMinorUnits(200) })
    const window = { start: '2026-08-01', end: '2026-08-31' }

    const desired = desiredOccurrences([bill, income], window)

    expect(desired.find((d) => d.ruleId === 'bill')?.amount).toBe(toMinorUnits(-50))
    expect(desired.find((d) => d.ruleId === 'pay')?.amount).toBe(toMinorUnits(200))
  })

  it('sorts ascending by rule id, then by date', () => {
    const ruleB = item({ id: 'b', cadence: 'weekly', nextOccurrence: '2026-08-06' })
    const ruleA = item({ id: 'a', cadence: 'weekly', nextOccurrence: '2026-08-06' })
    const window = { start: '2026-08-01', end: '2026-08-20' }

    const desired = desiredOccurrences([ruleB, ruleA], window)
    const ruleIds = desired.map((d) => d.ruleId)

    // Every 'a' row precedes every 'b' row, and each rule's own dates ascend.
    expect(ruleIds.indexOf('a')).toBeLessThan(ruleIds.lastIndexOf('a'))
    expect([...ruleIds].sort()).toEqual(ruleIds.slice().sort())
    const aDates = desired.filter((d) => d.ruleId === 'a').map((d) => d.date)
    expect(aDates).toEqual([...aDates].sort())
  })

  it('de-duplicates a (ruleId, date) pair even if it were offered twice', () => {
    // occurrenceDates already de-dupes within one rule (ascendingUnique), but
    // this guards the desired set's own contract defensively, per §2.7.
    const rule = item({ id: 'clamped', nextOccurrence: '2026-01-30', daysOfMonth: [30, 31] })
    const window = { start: '2026-02-01', end: '2026-02-28' }

    const desired = desiredOccurrences([rule], window)

    expect(desired).toEqual([{ ruleId: 'clamped', date: '2026-02-28', amount: toMinorUnits(-100) }])
  })

  it('returns an empty array for no items', () => {
    expect(desiredOccurrences([], { start: '2026-08-01', end: '2026-08-31' })).toEqual([])
  })

  it('returns an empty array when no rule occurs inside the window', () => {
    const rule = item({ endsOn: '2026-01-01' })
    expect(desiredOccurrences([rule], { start: '2026-08-01', end: '2026-08-31' })).toEqual([])
  })

  it('does not filter by account state — a rule on any account is still materialized', () => {
    // desiredOccurrences has no account collection to check archived state
    // against at all; it takes RecurringItem[] as given, which is the point —
    // see docs/database/schema.md, "Archiving, not deleting".
    const rule = item({ accountId: 'archived-account' })
    const window = { start: '2026-08-01', end: '2026-08-31' }

    expect(desiredOccurrences([rule], window)).toEqual([
      { ruleId: 'i', date: '2026-08-20', amount: toMinorUnits(-100) },
    ])
  })

  it('produces contiguous, non-overlapping dates across a rule split', () => {
    const oldRule = item({
      id: 'rent-old',
      name: 'Rent',
      cadence: 'monthly',
      nextOccurrence: '2026-08-01',
      amount: toMinorUnits(1650),
      endsOn: '2026-08-31',
    })
    const newRule = item({
      id: 'rent-new',
      name: 'Rent',
      cadence: 'monthly',
      nextOccurrence: '2026-09-01',
      amount: toMinorUnits(1750),
      startsOn: '2026-09-01',
    })
    const window = { start: '2026-06-01', end: '2026-12-31' }

    const desired = desiredOccurrences([oldRule, newRule], window)
    const dates = desired.map((d) => d.date)

    // No gap, no duplicate date, both rules present, each rule's own dates ascending.
    expect(dates).toEqual([...new Set(dates)])
    expect(desired.filter((d) => d.ruleId === 'rent-old').map((d) => d.date)).toEqual([
      '2026-06-01',
      '2026-07-01',
      '2026-08-01',
    ])
    expect(desired.filter((d) => d.ruleId === 'rent-new').map((d) => d.date)).toEqual([
      '2026-09-01',
      '2026-10-01',
      '2026-11-01',
      '2026-12-01',
    ])
  })
})
