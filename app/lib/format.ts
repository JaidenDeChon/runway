/**
 * Display formatting — the edge where integer minor units become strings.
 *
 * This is the only place money stops being an integer. Nothing here computes:
 * every function takes an already-final figure from the domain engine and
 * renders it. If a caller finds itself doing arithmetic to produce an argument
 * for one of these, that arithmetic belongs in `domain/`.
 *
 * Pure TypeScript, no Nuxt or Vue imports, so it runs under the `unit` test
 * project alongside the domain.
 */

import type { IsoDate } from '~~/domain/dates'
import type { MinorUnits } from '~~/domain/money'

/**
 * U+2212 MINUS SIGN, not U+002D HYPHEN-MINUS.
 *
 * The design specifies a typographic minus, and screen readers pronounce it as
 * "minus" rather than dropping it or reading "dash" — so this is an
 * accessibility fix as much as a typographic one.
 */
export const MINUS = '−'

const WHOLE_DOLLARS = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
})

const WITH_CENTS = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * `$2,140`, or `−$1,234` when negative.
 *
 * Every balance and amount in the design is shown to whole dollars. The sign is
 * placed before the currency symbol rather than inside the number, because
 * `-$1,234` is what the design shows and what `Intl` alone would not produce.
 */
export function formatMoney(minor: MinorUnits, options: { readonly cents?: boolean } = {}): string {
  const formatter = options.cents ? WITH_CENTS : WHOLE_DOLLARS
  const magnitude = formatter.format(Math.abs(minor) / 100)
  return minor < 0 ? `${MINUS}${magnitude}` : magnitude
}

/**
 * `+$2,450` / `−$310` — for figures whose direction is the point.
 *
 * Zero renders unsigned: a `+$0` reads as a gain that did not happen.
 */
export function formatMoneySigned(minor: MinorUnits): string {
  if (minor === 0) return formatMoney(0)
  const magnitude = formatMoney(Math.abs(minor))
  return minor > 0 ? `+${magnitude}` : `${MINUS}${magnitude}`
}

/**
 * A spoken equivalent for a signed amount, for `aria-label`.
 *
 * The visual `+`/`−` is a glyph; without this a screen reader announces
 * "310 dollars" for a bill and an income identically.
 */
export function describeMoneySigned(minor: MinorUnits, noun?: string): string {
  const direction = minor < 0 ? 'minus ' : minor > 0 ? 'plus ' : ''
  const magnitude = WHOLE_DOLLARS.format(Math.abs(minor) / 100)
  return noun ? `${noun}, ${direction}${magnitude}` : `${direction}${magnitude}`
}

/**
 * Formats an ISO calendar date without letting the local timezone shift it.
 *
 * `new Date('2026-08-20')` is midnight *UTC*; west of Greenwich that renders as
 * the 19th. Forcing the UTC timezone keeps a calendar day a calendar day.
 */
function formatIso(date: IsoDate, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  )
}

/** `Aug 20` */
export function formatDateShort(date: IsoDate): string {
  return formatIso(date, { month: 'short', day: 'numeric' })
}

/** `Aug 15, 2026` */
export function formatDateLong(date: IsoDate): string {
  return formatIso(date, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** `2026-08-20` → `08/20/2026`, matching a native date input's display. */
export function formatDateNumeric(date: IsoDate): string {
  return formatIso(date, { month: '2-digit', day: '2-digit', year: 'numeric' })
}

/**
 * `in 5 days` / `in 1 day` / `today`.
 *
 * Anything in the past collapses to `today` rather than "3 days ago": the
 * callers are all forecasts, where a past low point means the dip has already
 * happened and the user's question is about now.
 */
export function formatDaysAway(days: number): string {
  if (days <= 0) return 'today'
  return days === 1 ? 'in 1 day' : `in ${days} days`
}

/** Title-cased cadence for a row's meta line: `Monthly`, `Biweekly`, `Weekly`, `Annually`. */
export function formatCadence(cadence: string): string {
  if (cadence === 'annual') return 'Annually'
  return cadence.charAt(0).toUpperCase() + cadence.slice(1)
}
