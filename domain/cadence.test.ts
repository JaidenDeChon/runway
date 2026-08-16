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
      occurrenceDates(item({ cadence: 'biweekly', nextOccurrence: '2026-08-21' }), '2026-08-21', '2026-09-18'),
    ).toEqual(['2026-08-21', '2026-09-04', '2026-09-18'])
  })

  it('expands backwards from the anchor, so the look-back window is populated', () => {
    // The dashboard opens two weeks before today; occurrences in that stretch
    // already moved the balance and must not be dropped.
    expect(
      occurrenceDates(item({ cadence: 'weekly', nextOccurrence: '2026-08-20' }), '2026-08-01', '2026-08-20'),
    ).toEqual(['2026-08-06', '2026-08-13', '2026-08-20'])
  })

  it('clamps a month-end anchor without making the clamp stick', () => {
    expect(occurrenceDates(item({ nextOccurrence: '2026-01-31' }), '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ])
  })

  it('includes both range endpoints', () => {
    expect(occurrenceDates(item(), '2026-08-20', '2026-09-20')).toEqual(['2026-08-20', '2026-09-20'])
  })

  it('returns nothing for an inverted range', () => {
    expect(occurrenceDates(item(), '2026-09-01', '2026-08-01')).toEqual([])
  })

  it('terminates when the anchor is years from the window', () => {
    expect(occurrenceDates(item({ nextOccurrence: '2019-03-15' }), '2026-08-01', '2026-10-01')).toEqual([
      '2026-08-15',
      '2026-09-15',
    ])
  })
})
