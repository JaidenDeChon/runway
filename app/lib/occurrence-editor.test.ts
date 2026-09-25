import { describe, expect, it } from 'vitest'
import type { IsoDate } from '~~/domain/dates'
import { toMinorUnits } from '~~/domain/money'
import type { Occurrence } from '~~/domain/projection'
import {
  occurrenceKey,
  occurrenceQualifier,
  overrideSummary,
  plannedSummary,
  settledWord,
  settleLabel,
  settlementDate,
  settlementProblem,
  splitConsequence,
} from './occurrence-editor'

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

describe('settlement copy and rules (#26, manual half)', () => {
  it('money out is paid, money in is received', () => {
    expect(settledWord(toMinorUnits(-310))).toBe('Paid')
    expect(settledWord(toMinorUnits(2_000))).toBe('Received')
  })

  it('records a day that has not arrived as today, and says so on the button', () => {
    expect(settlementDate('2026-08-19', '2026-08-20')).toBe('2026-08-19')
    expect(settlementDate('2026-08-20', '2026-08-20')).toBe('2026-08-20')
    expect(settlementDate('2026-08-25', '2026-08-20')).toBe('2026-08-20')

    const bill = { projectedAmount: toMinorUnits(-310), today: '2026-08-20' as IsoDate }
    expect(settleLabel({ ...bill, formDate: '2026-08-20' })).toBe('Mark as paid')
    expect(settleLabel({ ...bill, formDate: '2026-08-25' })).toBe('Mark as paid today')
    expect(
      settleLabel({
        projectedAmount: toMinorUnits(2_000),
        formDate: '2026-08-01',
        today: '2026-08-20',
      }),
    ).toBe('Mark as received')
  })

  it('refuses a sign the database would refuse, with a reason', () => {
    const bill = toMinorUnits(-310)
    const income = toMinorUnits(2_000)
    expect(settlementProblem({ amount: toMinorUnits(-322), projectedAmount: bill })).toBeNull()
    expect(settlementProblem({ amount: toMinorUnits(322), projectedAmount: bill })).toMatch(
      /negative/,
    )
    expect(settlementProblem({ amount: 0, projectedAmount: bill })).toMatch(/negative/)
    expect(settlementProblem({ amount: toMinorUnits(2_100), projectedAmount: income })).toBeNull()
    expect(settlementProblem({ amount: toMinorUnits(-5), projectedAmount: income })).toMatch(
      /positive/,
    )
  })

  it('states what was planned beside what happened', () => {
    expect(
      plannedSummary({ projectedAmount: toMinorUnits(-310), projectedDate: '2026-08-20' }),
    ).toBe('Planned: \u2212$310 on Aug 20')
  })
})

describe('occurrenceQualifier', () => {
  const base: Occurrence = {
    id: 'i@2026-08-20',
    itemId: 'i',
    date: '2026-08-20',
    label: 'Electric',
    accountId: 'a',
    amount: toMinorUnits(-100),
    isVariable: true,
    isPredicted: false,
    projectedDate: '2026-08-20',
    projectedAmount: toMinorUnits(-100),
    isOverridden: false,
    isSettled: false,
  }

  it('ranks what happened over an edit over an estimate', () => {
    expect(occurrenceQualifier(base)).toBe('(estimated)')
    expect(occurrenceQualifier({ ...base, isOverridden: true, amount: toMinorUnits(-90) })).toBe(
      '(edited)',
    )
    expect(occurrenceQualifier({ ...base, isOverridden: true, isSettled: true })).toBe('(paid)')
    expect(
      occurrenceQualifier({
        ...base,
        amount: toMinorUnits(2_000),
        projectedAmount: toMinorUnits(2_000),
        isOverridden: true,
        isSettled: true,
      }),
    ).toBe('(received)')
    expect(occurrenceQualifier({ ...base, isVariable: false })).toBe('')
  })
})
