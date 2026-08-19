import { describe, expect, it } from 'vitest'
import { occurrenceDates } from './cadence'
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

describe('occurrenceDates', () => {
  it('expands monthly on the anchor day', () => {
    expect(occurrenceDates(item(), '2026-08-01', '2026-11-30')).toEqual([
      '2026-08-20',
      '2026-09-20',
      '2026-10-20',
      '2026-11-20',
    ])
  })

  it('expands biweekly', () => {
    expect(
      occurrenceDates(
        item({ cadence: 'biweekly', nextOccurrence: '2026-08-21' }),
        '2026-08-21',
        '2026-09-18',
      ),
    ).toEqual(['2026-08-21', '2026-09-04', '2026-09-18'])
  })

  it('expands backwards from the anchor, so the look-back window is populated', () => {
    // The dashboard opens two weeks before today; occurrences in that stretch
    // already moved the balance and must not be dropped.
    expect(
      occurrenceDates(
        item({ cadence: 'weekly', nextOccurrence: '2026-08-20' }),
        '2026-08-01',
        '2026-08-20',
      ),
    ).toEqual(['2026-08-06', '2026-08-13', '2026-08-20'])
  })

  it('clamps a month-end anchor without making the clamp stick', () => {
    expect(
      occurrenceDates(item({ nextOccurrence: '2026-01-31' }), '2026-01-01', '2026-04-30'),
    ).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
  })

  it('includes both range endpoints', () => {
    expect(occurrenceDates(item(), '2026-08-20', '2026-09-20')).toEqual([
      '2026-08-20',
      '2026-09-20',
    ])
  })

  it('returns nothing for an inverted range', () => {
    expect(occurrenceDates(item(), '2026-09-01', '2026-08-01')).toEqual([])
  })

  it('terminates when the anchor is years from the window', () => {
    expect(
      occurrenceDates(item({ nextOccurrence: '2019-03-15' }), '2026-08-01', '2026-10-01'),
    ).toEqual(['2026-08-15', '2026-09-15'])
  })

  it('expands annual across a multi-year window', () => {
    expect(
      occurrenceDates(
        item({ cadence: 'annual', nextOccurrence: '2026-03-15' }),
        '2026-01-01',
        '2029-12-31',
      ),
    ).toEqual(['2026-03-15', '2027-03-15', '2028-03-15', '2029-03-15'])
  })

  it('clamps an annual Feb-29 anchor to Feb 28 in non-leap years, without the clamp sticking', () => {
    expect(
      occurrenceDates(
        item({ cadence: 'annual', nextOccurrence: '2024-02-29' }),
        '2024-01-01',
        '2028-12-31',
      ),
    ).toEqual(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29'])
  })

  it('suppresses occurrences before startsOn, inclusive of the boundary', () => {
    expect(occurrenceDates(item({ startsOn: '2026-09-20' }), '2026-08-01', '2026-11-30')).toEqual([
      '2026-09-20',
      '2026-10-20',
      '2026-11-20',
    ])
  })

  it('suppresses occurrences after endsOn, inclusive of the boundary', () => {
    expect(occurrenceDates(item({ endsOn: '2026-10-20' }), '2026-08-01', '2026-11-30')).toEqual([
      '2026-08-20',
      '2026-09-20',
      '2026-10-20',
    ])
  })

  it('behaves exactly as before when the rule carries no window (look-back regression guard)', () => {
    expect(
      occurrenceDates(
        item({ cadence: 'weekly', nextOccurrence: '2026-08-20' }),
        '2026-08-01',
        '2026-08-20',
      ),
    ).toEqual(['2026-08-06', '2026-08-13', '2026-08-20'])
  })

  it('splits a rule at a change date: old rule ends, new rule starts, no gap or overlap', () => {
    const oldRule = item({
      name: 'Rent',
      cadence: 'monthly',
      nextOccurrence: '2026-08-01',
      amount: toMinorUnits(1650),
      endsOn: '2026-08-31',
    })
    const newRule = item({
      name: 'Rent',
      cadence: 'monthly',
      nextOccurrence: '2026-09-01',
      amount: toMinorUnits(1750),
      startsOn: '2026-09-01',
    })

    const oldDates = occurrenceDates(oldRule, '2026-06-01', '2026-12-31')
    const newDates = occurrenceDates(newRule, '2026-06-01', '2026-12-31')

    expect(oldDates).toEqual(['2026-06-01', '2026-07-01', '2026-08-01'])
    expect(newDates).toEqual(['2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01'])

    const combined = [...oldDates, ...newDates]
    expect(combined).toEqual([...new Set(combined)]) // no duplicate on the boundary
    expect(combined).toEqual([...combined].sort()) // strictly ascending, no gap month
  })
})
