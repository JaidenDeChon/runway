import { describe, expect, it } from 'vitest'
import { dailyFromMonthly } from './discretionary'
import { toMinorUnits } from './money'

describe('dailyFromMonthly', () => {
  it('returns 0 for 0', () => {
    expect(dailyFromMonthly(0)).toBe(0)
  })

  it('amortizes evenly across the year rather than stepping by month length', () => {
    // $34/day, the seeded figure in domain/seed.ts: 103400 * 12 / 365 = 3399.45...
    expect(dailyFromMonthly(103_400)).toBe(3399)
  })

  it('rounds to the nearest cent', () => {
    // 100 * 12 / 365 = 3.2876... -> rounds down to 3
    expect(dailyFromMonthly(100)).toBe(3)
    // 1000 * 12 / 365 = 32.876... -> rounds up to 33
    expect(dailyFromMonthly(1000)).toBe(33)
  })

  it('scales linearly with the monthly figure', () => {
    expect(dailyFromMonthly(toMinorUnits(365))).toBe(Math.round((toMinorUnits(365) * 12) / 365))
  })
})
