/**
 * The daily discretionary drain implied by a monthly figure.
 *
 * A user says "I spend about $1,000 a month on everything else". The engine
 * spends it for them, one day at a time, out of the account flagged as the
 * discretionary source.
 *
 * **Divided by the length of the month it falls in**, not amortized flat across
 * the average year. The flat form — `monthly * 12 / 365` — is tidier and was
 * what this module did first, but it drains only ~90% of the stated figure in
 * February and ~4% too much in a 31-day month. Under-draining is the failure
 * that matters: a runway app that quietly spends less than the user told it to
 * reports a higher low point than reality, which is the app saying "you're
 * covered" on a month the user is not. Every month now costs exactly what the
 * user said a month costs.
 *
 * The rounding is exact rather than nearest-cent. `round(monthly / length)`
 * loses or invents up to half a cent every day, which compounds across a
 * 90-day window; instead the whole-cent share goes to every day and the
 * remainder is handed out one cent each to the first days of the month, so the
 * days of any month sum to the monthly figure precisely. Front-loading the
 * remainder rather than trailing it means the balance dips a few cents earlier,
 * which is the safe direction to round in.
 */

import type { IsoDate } from './dates'
import { dayOfMonth, daysInMonth } from './dates'
import type { MinorUnits } from './money'

/**
 * What discretionary spending costs on `date`, given a monthly figure.
 *
 * Returned as a positive magnitude; the projection engine applies the sign.
 *
 * ```ts
 * dailyDiscretionary(100_000, '2026-01-01') // 3226 — $1,000 over 31 days, +1c
 * dailyDiscretionary(100_000, '2026-01-31') // 3225
 * dailyDiscretionary(100_000, '2026-02-01') // 3572 — the same $1,000 over 28
 * ```
 */
export function dailyDiscretionary(monthlyCents: MinorUnits, date: IsoDate): MinorUnits {
  if (monthlyCents <= 0) return 0
  const length = daysInMonth(date)
  const share = Math.floor(monthlyCents / length)
  const remainder = monthlyCents - share * length
  return dayOfMonth(date) <= remainder ? share + 1 : share
}
