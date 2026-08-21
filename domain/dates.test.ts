import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonthsClamped,
  compareDates,
  dayOfMonth,
  daysBetween,
  eachDay,
  isIsoDate,
  isoWeekday,
  maxDate,
  minDate,
  monthIndex,
  startOfIsoWeek,
} from './dates'

describe('isIsoDate', () => {
  it('rejects well-formed impossible dates', () => {
    // `new Date('2026-02-30')` silently rolls into March; that must not pass.
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('2026-13-01')).toBe(false)
  })

  it('accepts a real leap day', () => {
    expect(isIsoDate('2028-02-29')).toBe(true)
    expect(isIsoDate('2026-02-29')).toBe(false)
  })
})

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('is unaffected by daylight saving, because it works in UTC', () => {
    // In US zones 2026-03-08 is a 23-hour day; a local-time implementation
    // would land back on the same date here.
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09')
  })
})

describe('daysBetween', () => {
  it('is signed and inverse-symmetric', () => {
    expect(daysBetween('2026-08-15', '2026-08-20')).toBe(5)
    expect(daysBetween('2026-08-20', '2026-08-15')).toBe(-5)
  })
})

describe('addMonthsClamped', () => {
  it('clamps to the end of a short month', () => {
    expect(addMonthsClamped('2026-01-31', 1, 31)).toBe('2026-02-28')
  })

  it('does not make the clamp sticky', () => {
    // The March occurrence returns to the 31st rather than staying on the 28th.
    expect(addMonthsClamped('2026-01-31', 2, 31)).toBe('2026-03-31')
  })

  it('steps backwards', () => {
    expect(addMonthsClamped('2026-03-31', -1, 31)).toBe('2026-02-28')
  })
})

describe('eachDay', () => {
  it('is inclusive of both ends', () => {
    expect(eachDay('2026-08-15', '2026-08-17')).toEqual(['2026-08-15', '2026-08-16', '2026-08-17'])
  })

  it('returns nothing for an inverted range', () => {
    expect(eachDay('2026-08-17', '2026-08-15')).toEqual([])
  })
})

describe('comparison helpers', () => {
  it('orders chronologically', () => {
    expect(compareDates('2026-08-15', '2026-09-01')).toBeLessThan(0)
    expect(minDate('2026-09-01', '2026-08-15')).toBe('2026-08-15')
    expect(maxDate('2026-09-01', '2026-08-15')).toBe('2026-09-01')
  })

  it('reads the day of month', () => {
    expect(dayOfMonth('2026-08-20')).toBe(20)
  })
})

describe('week and month indexing', () => {
  it('numbers weekdays ISO-style, Monday through Sunday', () => {
    expect(isoWeekday('2026-08-17')).toBe(1) // Monday
    expect(isoWeekday('2026-08-20')).toBe(4) // Thursday
    expect(isoWeekday('2026-08-23')).toBe(7) // Sunday — 7, not JavaScript's 0
  })

  it('takes the Monday on or before a date as its week', () => {
    expect(startOfIsoWeek('2026-08-20')).toBe('2026-08-17')
    expect(startOfIsoWeek('2026-08-17')).toBe('2026-08-17')
    // Sunday belongs to the week that started six days earlier, not the next one.
    expect(startOfIsoWeek('2026-08-23')).toBe('2026-08-17')
  })

  it('counts months monotonically across a year boundary', () => {
    expect(monthIndex('2027-01-01') - monthIndex('2026-12-31')).toBe(1)
    expect(monthIndex('2026-08-01') - monthIndex('2026-08-31')).toBe(0)
    expect(monthIndex('2026-08-15') - monthIndex('2025-08-15')).toBe(12)
  })
})
