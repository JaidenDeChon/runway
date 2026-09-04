import { describe, expect, it } from 'vitest'
import {
  describeMoneySigned,
  formatCadence,
  formatDateLong,
  formatDateNumeric,
  formatDateShort,
  formatDaysAway,
  formatMoney,
  formatMoneySigned,
  MINUS,
} from './format'

describe('formatMoney', () => {
  it('renders whole dollars with a thousands separator', () => {
    expect(formatMoney(214_000)).toBe('$2,140')
  })

  it('puts a typographic minus before the currency symbol', () => {
    expect(formatMoney(-123_400)).toBe(`${MINUS}$1,234`)
    // U+2212, not the U+002D a keyboard produces.
    expect(formatMoney(-1).charCodeAt(0)).toBe(0x2212)
  })

  it('shows cents only when asked', () => {
    expect(formatMoney(214_099)).toBe('$2,141')
    expect(formatMoney(214_099, { cents: true })).toBe('$2,140.99')
  })

  it('renders zero unsigned', () => {
    expect(formatMoney(0)).toBe('$0')
  })
})

describe('formatMoneySigned', () => {
  it('signs income and bills differently', () => {
    expect(formatMoneySigned(245_000)).toBe('+$2,450')
    expect(formatMoneySigned(-31_000)).toBe(`${MINUS}$310`)
  })

  it('leaves zero unsigned, since +$0 reads as a gain that did not happen', () => {
    expect(formatMoneySigned(0)).toBe('$0')
  })
})

describe('describeMoneySigned', () => {
  it('spells out the direction that the glyph carries visually', () => {
    expect(describeMoneySigned(-31_000, 'Car payment')).toBe('Car payment, minus $310')
    expect(describeMoneySigned(245_000, 'Paycheck')).toBe('Paycheck, plus $2,450')
  })

  it('omits the direction for zero', () => {
    expect(describeMoneySigned(0)).toBe('$0')
  })
})

describe('date formatting', () => {
  it('does not let the local timezone shift a calendar day', () => {
    // The classic failure: `new Date('2026-08-20')` is UTC midnight, which is
    // the 19th anywhere west of Greenwich.
    expect(formatDateShort('2026-08-20')).toBe('Aug 20')
    expect(formatDateLong('2026-01-01')).toBe('Jan 1, 2026')
    expect(formatDateNumeric('2026-08-15')).toBe('08/15/2026')
  })
})

describe('formatDaysAway', () => {
  it('singularises one day', () => {
    expect(formatDaysAway(1)).toBe('in 1 day')
    expect(formatDaysAway(5)).toBe('in 5 days')
  })

  it('collapses today and the past to "today"', () => {
    expect(formatDaysAway(0)).toBe('today')
    expect(formatDaysAway(-3)).toBe('today')
  })
})

describe('formatCadence', () => {
  it('title-cases for the row meta line', () => {
    expect(formatCadence('biweekly')).toBe('Biweekly')
  })

  it('renders annual as "Annually" rather than a bare title-case', () => {
    expect(formatCadence('annual')).toBe('Annually')
  })
})
