import { describe, expect, it } from 'vitest'
import { eachDay } from './dates'
import { dailyDiscretionary } from './discretionary'
import { toMinorUnits } from './money'

/** What the month containing `date` actually costs, day by day. */
function monthTotal(monthlyCents: number, firstOfMonth: string, lastOfMonth: string): number {
  return eachDay(firstOfMonth, lastOfMonth).reduce(
    (total, date) => total + dailyDiscretionary(monthlyCents, date),
    0,
  )
}

describe('dailyDiscretionary', () => {
  it('is 0 for 0, and for a nonsensical negative figure', () => {
    expect(dailyDiscretionary(0, '2026-08-20')).toBe(0)
    expect(dailyDiscretionary(-5000, '2026-08-20')).toBe(0)
  })

  it('divides by the length of the month it falls in', () => {
    // $1,000 over January's 31 days, over February's 28, over April's 30.
    expect(dailyDiscretionary(100_000, '2026-01-28')).toBe(3225)
    expect(dailyDiscretionary(100_000, '2026-02-15')).toBe(3571)
    expect(dailyDiscretionary(100_000, '2026-04-15')).toBe(3333)
  })

  it('spends exactly the monthly figure in every month, to the cent', () => {
    const monthly = toMinorUnits(1034)
    expect(monthTotal(monthly, '2026-01-01', '2026-01-31')).toBe(monthly)
    expect(monthTotal(monthly, '2026-02-01', '2026-02-28')).toBe(monthly)
    expect(monthTotal(monthly, '2026-04-01', '2026-04-30')).toBe(monthly)
    // The leap day is a 29th share, not a free day.
    expect(monthTotal(monthly, '2024-02-01', '2024-02-29')).toBe(monthly)
  })

  it('spends the same figure whatever the remainder happens to be', () => {
    // Every remainder 0..30 against a 31-day month.
    for (let cents = 100_000; cents < 100_031; cents++) {
      expect(monthTotal(cents, '2026-01-01', '2026-01-31')).toBe(cents)
    }
  })

  it('hands the remainder to the first days of the month, one cent each', () => {
    // $1,000 / 31 = 3225 remainder 25, so the 1st through the 25th pay 3226.
    expect(dailyDiscretionary(100_000, '2026-01-01')).toBe(3226)
    expect(dailyDiscretionary(100_000, '2026-01-25')).toBe(3226)
    expect(dailyDiscretionary(100_000, '2026-01-26')).toBe(3225)
    expect(dailyDiscretionary(100_000, '2026-01-31')).toBe(3225)
  })

  it('never differs by more than a cent within a month', () => {
    const days = eachDay('2026-03-01', '2026-03-31').map((date) =>
      dailyDiscretionary(toMinorUnits(777), date),
    )
    expect(Math.max(...days) - Math.min(...days)).toBeLessThanOrEqual(1)
  })

  it('costs more per day in a short month than a long one', () => {
    const monthly = toMinorUnits(600)
    expect(dailyDiscretionary(monthly, '2026-02-10')).toBeGreaterThan(
      dailyDiscretionary(monthly, '2026-01-10'),
    )
  })
})
