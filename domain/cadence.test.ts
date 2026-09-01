import { describe, expect, it } from 'vitest'
import { nextOccurrenceOnOrAfter, occurrenceDates } from './cadence'
import { toMinorUnits } from './money'
import { LAST_DAY_OF_MONTH, type RecurringItem } from './types'

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

describe('occurrenceDates with a day set', () => {
  it('expands semi-monthly from daysOfMonth, without a semimonthly cadence existing', () => {
    expect(
      occurrenceDates(
        item({ cadence: 'monthly', nextOccurrence: '2026-08-01', daysOfMonth: [1, 15] }),
        '2026-08-01',
        '2026-09-30',
      ),
    ).toEqual(['2026-08-01', '2026-08-15', '2026-09-01', '2026-09-15'])
  })

  it('does not care what order the days arrive in, or whether they repeat', () => {
    // The database normalises the stored array, but the engine is not allowed to
    // depend on that having happened — it also runs over unsaved form state.
    expect(
      occurrenceDates(
        item({ cadence: 'monthly', nextOccurrence: '2026-08-01', daysOfMonth: [15, 1, 15] }),
        '2026-08-01',
        '2026-08-31',
      ),
    ).toEqual(['2026-08-01', '2026-08-15'])
  })

  it('collapses days that clamp onto the same date instead of emitting it twice', () => {
    // February 2026 has 28 days, so the 30th and the 31st are the same occurrence.
    // `occurrences` is unique on (rule_id, projected_date); two rows here could
    // not be stored.
    expect(
      occurrenceDates(
        item({ cadence: 'monthly', nextOccurrence: '2026-01-30', daysOfMonth: [30, 31] }),
        '2026-02-01',
        '2026-02-28',
      ),
    ).toEqual(['2026-02-28'])
  })

  it('reads -1 as month end, in months of every length', () => {
    expect(
      occurrenceDates(
        item({
          cadence: 'monthly',
          nextOccurrence: '2026-01-01',
          daysOfMonth: [1, LAST_DAY_OF_MONTH],
        }),
        '2026-01-01',
        '2026-03-31',
      ),
    ).toEqual(['2026-01-01', '2026-01-31', '2026-02-01', '2026-02-28', '2026-03-01', '2026-03-31'])
  })

  it('expands a day set backwards from the anchor too', () => {
    expect(
      occurrenceDates(
        item({ cadence: 'monthly', nextOccurrence: '2026-09-15', daysOfMonth: [1, 15] }),
        '2026-08-01',
        '2026-09-15',
      ),
    ).toEqual(['2026-08-01', '2026-08-15', '2026-09-01', '2026-09-15'])
  })

  it('expands weekly onto several weekdays, ISO-numbered', () => {
    // 1 = Monday, 4 = Thursday. The anchor is a Thursday; the Mondays of the
    // same weeks come too, including the one before the anchor.
    expect(
      occurrenceDates(
        item({ cadence: 'weekly', nextOccurrence: '2026-08-20', daysOfWeek: [1, 4] }),
        '2026-08-17',
        '2026-09-03',
      ),
    ).toEqual(['2026-08-17', '2026-08-20', '2026-08-24', '2026-08-27', '2026-08-31', '2026-09-03'])
  })

  it('keeps the biweekly phase when several weekdays are named', () => {
    // Every other week counted from the anchor's week, not every other pair of
    // dates: the weeks of Aug 24 and Sep 7 are skipped entirely.
    expect(
      occurrenceDates(
        item({ cadence: 'biweekly', nextOccurrence: '2026-08-20', daysOfWeek: [1, 4] }),
        '2026-08-17',
        '2026-09-17',
      ),
    ).toEqual(['2026-08-17', '2026-08-20', '2026-08-31', '2026-09-03', '2026-09-14', '2026-09-17'])
  })

  it('ignores a day set that does not belong to the cadence', () => {
    // The database refuses to store these combinations at all; the engine simply
    // does not read them, so a stale field cannot change a projection.
    expect(
      occurrenceDates(
        item({ cadence: 'weekly', nextOccurrence: '2026-08-20', daysOfMonth: [1, 15] }),
        '2026-08-20',
        '2026-09-03',
      ),
    ).toEqual(['2026-08-20', '2026-08-27', '2026-09-03'])

    expect(
      occurrenceDates(
        item({ cadence: 'monthly', nextOccurrence: '2026-08-20', daysOfWeek: [1, 4] }),
        '2026-08-01',
        '2026-10-31',
      ),
    ).toEqual(['2026-08-20', '2026-09-20', '2026-10-20'])
  })

  it('falls back to the anchor day when the day set is empty', () => {
    // Unreachable from storage — the check constraint rejects `{}` — but the
    // engine also runs over half-filled form state, where "no days chosen yet"
    // must not mean "no occurrences ever".
    expect(
      occurrenceDates(
        item({ cadence: 'monthly', nextOccurrence: '2026-08-20', daysOfMonth: [] }),
        '2026-08-01',
        '2026-09-30',
      ),
    ).toEqual(['2026-08-20', '2026-09-20'])
  })

  it('still respects startsOn and endsOn', () => {
    expect(
      occurrenceDates(
        item({
          cadence: 'monthly',
          nextOccurrence: '2026-08-01',
          daysOfMonth: [1, 15],
          startsOn: '2026-08-15',
          endsOn: '2026-09-01',
        }),
        '2026-07-01',
        '2026-12-31',
      ),
    ).toEqual(['2026-08-15', '2026-09-01'])
  })
})

describe('month-end clamping across leap and non-leap Februaries', () => {
  it('clamps a monthly 31st anchor to Feb 29 in a leap year, without the clamp sticking', () => {
    expect(
      occurrenceDates(item({ nextOccurrence: '2028-01-31' }), '2028-01-01', '2028-03-31'),
    ).toEqual(['2028-01-31', '2028-02-29', '2028-03-31'])
  })

  it('clamps a monthly 31st anchor to Feb 28 in a non-leap year, without the clamp sticking', () => {
    expect(
      occurrenceDates(item({ nextOccurrence: '2027-01-31' }), '2027-01-01', '2027-03-31'),
    ).toEqual(['2027-01-31', '2027-02-28', '2027-03-31'])
  })

  it('LAST_DAY_OF_MONTH lands on the true last day of 28-, 29-, 30- and 31-day months', () => {
    expect(
      occurrenceDates(
        item({ nextOccurrence: '2028-01-01', daysOfMonth: [LAST_DAY_OF_MONTH] }),
        '2028-01-01',
        '2028-04-30',
      ),
    ).toEqual(['2028-01-31', '2028-02-29', '2028-03-31', '2028-04-30'])

    expect(
      occurrenceDates(
        item({ nextOccurrence: '2027-01-01', daysOfMonth: [LAST_DAY_OF_MONTH] }),
        '2027-01-01',
        '2027-02-28',
      ),
    ).toEqual(['2027-01-31', '2027-02-28'])
  })
})

describe('nextOccurrenceOnOrAfter', () => {
  it('returns the anchor itself when `from` equals it', () => {
    expect(nextOccurrenceOnOrAfter(item({ nextOccurrence: '2026-08-20' }), '2026-08-20')).toBe(
      '2026-08-20',
    )
  })

  it('returns the next cycle when `from` is one day past the anchor', () => {
    expect(nextOccurrenceOnOrAfter(item({ nextOccurrence: '2026-08-20' }), '2026-08-21')).toBe(
      '2026-09-20',
    )
  })

  it('returns null once endsOn has passed', () => {
    expect(
      nextOccurrenceOnOrAfter(
        item({ nextOccurrence: '2026-08-20', endsOn: '2026-08-20' }),
        '2026-08-21',
      ),
    ).toBeNull()
  })

  it('respects startsOn in the future', () => {
    expect(
      nextOccurrenceOnOrAfter(
        item({ nextOccurrence: '2026-08-20', startsOn: '2026-10-20' }),
        '2026-08-21',
      ),
    ).toBe('2026-10-20')
  })

  it('finds an annual rule anchored on Feb 29 from a Mar 1 start in a non-leap year — the case withinDays=400 exists for', () => {
    expect(
      nextOccurrenceOnOrAfter(
        item({ cadence: 'annual', nextOccurrence: '2024-02-29' }),
        '2025-03-01',
      ),
    ).toBe('2026-02-28')
  })

  it('returns null when a caller-supplied `withinDays` closes the search before the rule recurs', () => {
    // Monthly, so the very next occurrence is only ~30 days out — but a
    // 10-day window closes before it arrives.
    expect(
      nextOccurrenceOnOrAfter(item({ nextOccurrence: '2026-08-20' }), '2026-08-21', 10),
    ).toBeNull()
  })
})
