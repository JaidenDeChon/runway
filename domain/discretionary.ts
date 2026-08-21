/**
 * Converting the stored monthly discretionary figure into the flat daily rate
 * the projection engine drains.
 *
 * A flat calendar-day rate, not a per-month-length one: `domain/projection.ts`
 * `buildDeltas` already drains a constant amount per day, so a bill-style
 * "divide by the number of days in *this* month" would make the discretionary
 * line step at every month boundary for no reason a user could see coming.
 * `* 12 / 365` amortizes evenly across the average year instead.
 */

import type { MinorUnits } from './money'

/** The flat daily discretionary spend implied by a monthly figure. */
export function dailyFromMonthly(monthlyCents: MinorUnits): MinorUnits {
  return Math.round((monthlyCents * 12) / 365)
}
