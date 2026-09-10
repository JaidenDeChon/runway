import { describe, expect, it } from 'vitest'
import { addDays } from '~~/domain/dates'
import { SHORTFALL_OUTLOOK_HORIZON_DAYS } from '~~/domain/projection'
import {
  parseBillId,
  parseMode,
  parseTargetDate,
  resolveBillId,
  resolveMode,
  resolveTargetDate,
  TARGET_DEFAULT_OFFSET_DAYS,
  TARGET_MAX_OFFSET_DAYS,
} from './shortfall-target'

const TODAY = '2026-08-15'

describe('parseMode', () => {
  it('accepts the two exact strings', () => {
    expect(parseMode('bill')).toBe('bill')
    expect(parseMode('date')).toBe('date')
  })

  it('rejects anything else, without trimming or case-folding', () => {
    expect(parseMode('Bill')).toBeNull()
    expect(parseMode(' bill')).toBeNull()
    expect(parseMode('nope')).toBeNull()
  })

  it('is null for a bare ?mode (no value at all)', () => {
    expect(parseMode(null)).toBeNull()
    expect(parseMode(undefined)).toBeNull()
  })

  it('takes the first value of a repeated param', () => {
    expect(parseMode(['bill', 'date'])).toBe('bill')
    expect(parseMode(['date', 'bill'])).toBe('date')
  })
})

describe('parseBillId', () => {
  const billIds = ['bill-1', 'bill-2']

  it('returns the id when it is a member of the household', () => {
    expect(parseBillId('bill-1', billIds)).toBe('bill-1')
  })

  it('is null for an id the household does not hold', () => {
    expect(parseBillId('bill-nope', billIds)).toBeNull()
  })

  it('is null against an empty bill list', () => {
    expect(parseBillId('bill-1', [])).toBeNull()
  })

  it('is null for a bare ?bill', () => {
    expect(parseBillId(null, billIds)).toBeNull()
  })

  it('takes the first value of a repeated param', () => {
    expect(parseBillId(['bill-2', 'bill-1'], billIds)).toBe('bill-2')
  })
})

describe('parseTargetDate', () => {
  it('accepts a valid in-range date', () => {
    expect(parseTargetDate('2026-08-20', TODAY)).toBe('2026-08-20')
  })

  it('rejects today itself — one day before the minimum', () => {
    expect(parseTargetDate(TODAY, TODAY)).toBeNull()
  })

  it('accepts the boundaries, today+1 and today+180', () => {
    expect(parseTargetDate(addDays(TODAY, 1), TODAY)).toBe(addDays(TODAY, 1))
    expect(parseTargetDate(addDays(TODAY, 180), TODAY)).toBe(addDays(TODAY, 180))
  })

  it('rejects one day past the maximum', () => {
    expect(parseTargetDate(addDays(TODAY, 181), TODAY)).toBeNull()
  })

  it('rejects a date in the past', () => {
    expect(parseTargetDate(addDays(TODAY, -1), TODAY)).toBeNull()
  })

  it('rejects a well-formed-but-impossible date', () => {
    expect(parseTargetDate('2026-02-30', TODAY)).toBeNull()
  })

  it('rejects a non-date string', () => {
    expect(parseTargetDate('not-a-date', TODAY)).toBeNull()
  })

  it('is null for a bare ?on', () => {
    expect(parseTargetDate(null, TODAY)).toBeNull()
  })
})

describe('resolveMode', () => {
  it('reproduces the mount-time rule when nothing was parsed: bill when there are bills, else date', () => {
    expect(resolveMode(null, true)).toBe('bill')
    expect(resolveMode(null, false)).toBe('date')
  })

  it('honours an explicit date even when bills exist', () => {
    expect(resolveMode('date', true)).toBe('date')
  })

  it('falls back to date when bill mode was asked for but there is nothing to point at', () => {
    expect(resolveMode('bill', false)).toBe('date')
  })

  it('honours an explicit bill mode when bills exist', () => {
    expect(resolveMode('bill', true)).toBe('bill')
  })
})

describe('resolveBillId', () => {
  const billIds = ['bill-1', 'bill-2']

  it('passes through a parsed id', () => {
    expect(resolveBillId('bill-2', billIds)).toBe('bill-2')
  })

  it('falls back to the first bill when nothing was parsed', () => {
    expect(resolveBillId(null, billIds)).toBe('bill-1')
  })

  it('falls back to null when there are no bills at all', () => {
    expect(resolveBillId(null, [])).toBeNull()
  })
})

describe('resolveTargetDate', () => {
  it('passes through a parsed date', () => {
    expect(resolveTargetDate('2026-08-20', TODAY)).toBe('2026-08-20')
  })

  it('falls back to today+14 when nothing was parsed', () => {
    expect(resolveTargetDate(null, TODAY)).toBe(addDays(TODAY, TARGET_DEFAULT_OFFSET_DAYS))
  })
})

describe('SHORTFALL_OUTLOOK_HORIZON_DAYS', () => {
  // The engine cannot import from app/, so `shortfallOutlook`'s horizon and
  // this screen's furthest selectable target are two separate constants kept
  // in step by this test rather than a shared one — see the doc comment on
  // `SHORTFALL_OUTLOOK_HORIZON_DAYS` in domain/projection.ts.
  it('matches the furthest offset the date input allows', () => {
    expect(SHORTFALL_OUTLOOK_HORIZON_DAYS).toBe(TARGET_MAX_OFFSET_DAYS)
  })
})
