import { describe, expect, it } from 'vitest'
import type { IsoDate } from '~~/domain/dates'
import { toMinorUnits } from '~~/domain/money'
import { occurrenceKey, overrideSummary, splitConsequence } from './occurrence-editor'

describe('splitConsequence', () => {
  it('says the estimate stops when the rule is estimated (#18), and only then', () => {
    const base = {
      label: 'Paycheck',
      cadence: 'biweekly' as const,
      effectiveFrom: '2026-09-01',
      amount: toMinorUnits(2_450),
    }
    expect(splitConsequence({ ...base, estimating: true })).toContain('no longer estimated')
    expect(splitConsequence(base)).not.toContain('estimated')
  })

  it('names the label, the new amount, the cadence and the effective date', () => {
    const text = splitConsequence({
      label: 'Rent',
      cadence: 'monthly',
      effectiveFrom: '2026-09-01',
      amount: toMinorUnits(1_750),
    })
    expect(text).toContain('Rent')
    expect(text).toContain('$1,750')
    expect(text).toContain('Sep 1')
    expect(text).toContain('each month')
  })

  it('states the closing date as the day before effectiveFrom', () => {
    const text = splitConsequence({
      label: 'Rent',
      cadence: 'monthly',
      effectiveFrom: '2026-09-01',
      amount: toMinorUnits(1_750),
    })
    expect(text).toContain('Aug 31')
  })

  it('handles a month boundary correctly for a non-first-of-month effective date', () => {
    const text = splitConsequence({
      label: 'Paycheck',
      cadence: 'biweekly',
      effectiveFrom: '2026-03-01',
      amount: toMinorUnits(2_450),
    })
    expect(text).toContain('Feb 28')
    expect(text).toContain('every two weeks')
  })

  it('uses the right adverb for each cadence', () => {
    const forCadence = (cadence: 'weekly' | 'biweekly' | 'monthly' | 'annual') =>
      splitConsequence({
        label: 'Item',
        cadence,
        effectiveFrom: '2026-09-01',
        amount: toMinorUnits(100),
      })
    expect(forCadence('weekly')).toContain('each week')
    expect(forCadence('biweekly')).toContain('every two weeks')
    expect(forCadence('monthly')).toContain('each month')
    expect(forCadence('annual')).toContain('each year')
  })

  it('says "past occurrences are kept" — the history-preservation stance', () => {
    const text = splitConsequence({
      label: 'Rent',
      cadence: 'monthly',
      effectiveFrom: '2026-09-01',
      amount: toMinorUnits(1_750),
    })
    expect(text).toContain('past occurrences are kept')
  })
})

describe('overrideSummary', () => {
  it('names the rule value and the day it applies to', () => {
    const text = overrideSummary({
      projectedAmount: -toMinorUnits(310),
      projectedDate: '2026-08-20',
    })
    expect(text).toContain('$310')
    expect(text).toContain('Aug 20')
  })
})

describe('occurrenceKey', () => {
  it('keys on the pair a retime cannot move', () => {
    // `Occurrence.id` is rewritten the moment an override lands, so a list
    // keyed on it remounts every row it edits. This pair does not move.
    expect(occurrenceKey('rent', '2026-09-20' as IsoDate)).toBe('rent@2026-09-20')
  })

  it('separates two occurrences of the same rule', () => {
    expect(occurrenceKey('rent', '2026-09-20' as IsoDate)).not.toBe(
      occurrenceKey('rent', '2026-10-20' as IsoDate),
    )
  })
})
