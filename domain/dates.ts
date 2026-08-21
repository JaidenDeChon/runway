/**
 * Calendar-day arithmetic on ISO `YYYY-MM-DD` strings.
 *
 * Runway reasons in whole local calendar days, never in instants: a bill due on
 * the 20th is due on the 20th regardless of the reader's timezone. Every helper
 * here therefore parses to a UTC midnight and works in UTC, so a user in UTC-7
 * and a user in UTC+9 project the same series from the same data.
 *
 * Formatting for display is deliberately absent — that happens at the app edge
 * (`app/lib/format.ts`) where a locale is available.
 */

/** An ISO calendar date, `YYYY-MM-DD`. Not an instant; has no time or zone. */
export type IsoDate = string

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MS_PER_DAY = 86_400_000

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false
  // Rejects the well-formed-but-impossible (2026-02-30), which `Date` would
  // otherwise roll forward into March rather than refuse.
  return toUtcMillis(value) !== null
}

function toUtcMillis(date: IsoDate): number | null {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  const day = Number(date.slice(8, 10))
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const millis = Date.UTC(year, month - 1, day)
  const roundTrip = new Date(millis)
  if (roundTrip.getUTCMonth() !== month - 1 || roundTrip.getUTCDate() !== day) return null
  return millis
}

function requireMillis(date: IsoDate): number {
  const millis = toUtcMillis(date)
  if (millis === null) throw new RangeError(`Not a valid ISO date: ${date}`)
  return millis
}

function fromUtcMillis(millis: number): IsoDate {
  return new Date(millis).toISOString().slice(0, 10)
}

/** Returns `date` shifted by `days` (negative shifts backwards). */
export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtcMillis(requireMillis(date) + days * MS_PER_DAY)
}

/** Whole days from `from` to `to`. Negative when `to` precedes `from`. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((requireMillis(to) - requireMillis(from)) / MS_PER_DAY)
}

/** Day-of-month, 1–31. */
export function dayOfMonth(date: IsoDate): number {
  return new Date(requireMillis(date)).getUTCDate()
}

export function compareDates(a: IsoDate, b: IsoDate): number {
  // ISO dates are zero-padded and fixed-width, so lexical order is chronological.
  return a < b ? -1 : a > b ? 1 : 0
}

export function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return compareDates(a, b) <= 0 ? a : b
}

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return compareDates(a, b) >= 0 ? a : b
}

/**
 * Adds `months` calendar months, clamping to the end of the target month.
 *
 * Clamping is what makes a "monthly on the 31st" bill land on Feb 28 rather
 * than rolling into March — and, critically, the clamp is not sticky: the
 * anchor day is carried separately by the caller, so the March occurrence
 * returns to the 31st instead of staying on the 28th.
 */
export function addMonthsClamped(date: IsoDate, months: number, anchorDay: number): IsoDate {
  const base = new Date(requireMillis(date))
  const year = base.getUTCFullYear()
  const month = base.getUTCMonth() + months
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return fromUtcMillis(Date.UTC(year, month, Math.min(anchorDay, lastDayOfTarget)))
}

/**
 * ISO weekday: 1 = Monday through 7 = Sunday.
 *
 * ISO numbering rather than JavaScript's 0 = Sunday, because it is what
 * `recurring_rules.days_of_week` stores and what a person reading "1 and 4"
 * expects to mean Monday and Thursday.
 */
export function isoWeekday(date: IsoDate): number {
  return ((new Date(requireMillis(date)).getUTCDay() + 6) % 7) + 1
}

/** The Monday on or before `date`. The week a date belongs to, ISO-style. */
export function startOfIsoWeek(date: IsoDate): IsoDate {
  return addDays(date, 1 - isoWeekday(date))
}

/**
 * A monotonically increasing month number — `year * 12 + month`.
 *
 * Only differences between two of these are meaningful. It exists so a caller
 * can jump straight to the month a window starts in instead of stepping there
 * one cycle at a time.
 */
export function monthIndex(date: IsoDate): number {
  const base = new Date(requireMillis(date))
  return base.getUTCFullYear() * 12 + base.getUTCMonth()
}

/** Every calendar day from `start` to `end`, inclusive. Empty if `end < start`. */
export function eachDay(start: IsoDate, end: IsoDate): IsoDate[] {
  const span = daysBetween(start, end)
  if (span < 0) return []
  const days: IsoDate[] = []
  for (let offset = 0; offset <= span; offset++) days.push(addDays(start, offset))
  return days
}
