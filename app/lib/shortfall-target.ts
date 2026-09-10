/**
 * Parsing and resolution for `/will-i-make-it`'s three query params.
 *
 * Pure TypeScript, no Vue or Nuxt imports, so it runs under the `unit` test
 * project alongside the domain — `app/lib/format.ts` sets the precedent for a
 * pure `app/lib` module importing from `~~/domain`.
 *
 * The route is the single source of truth for the screen's target (issue
 * #14's Decision 2): a mode, a bill id and a date live in the URL, never in
 * `user_settings` or `localStorage`, so a reload or a shared link reproduces
 * exactly the question that was on screen. Every `parse*` function here
 * treats its input as untrusted — an unknown bill id, a malformed or
 * out-of-range date, or an unknown mode all resolve to `null` rather than
 * throwing, and the paired `resolve*` function supplies the screen's normal
 * default. Nothing here is ever an amount or a balance — a bill id is an
 * opaque uuid and a date is a calendar day, both fine to carry in a URL.
 */

import { addDays, compareDates, type IsoDate, isIsoDate } from '~~/domain/dates'

export type ShortfallMode = 'bill' | 'date'

/** The three query keys this screen owns. Nothing else may appear in its URL. */
export const SHORTFALL_QUERY = { mode: 'mode', bill: 'bill', on: 'on' } as const

/** How vue-router 5 hands a query value over: string | null, or an array of those. */
export type QueryValue = string | null | undefined | readonly (string | null)[]

/** The bounds the date input already enforces (AskCard.vue): tomorrow through 180 days out. */
export const TARGET_MIN_OFFSET_DAYS = 1
export const TARGET_MAX_OFFSET_DAYS = 180
/** The default target in date mode, unchanged from the screen's current behaviour. */
export const TARGET_DEFAULT_OFFSET_DAYS = 14

/** A repeated param takes the first value; a bare `?key` (`null`) is absent. */
function firstValue(value: QueryValue): string | null {
  const single = Array.isArray(value) ? (value[0] ?? null) : value
  return single ?? null
}

/** Accepts the two exact strings only — no trimming, no case-folding. */
export function parseMode(value: QueryValue): ShortfallMode | null {
  const raw = firstValue(value)
  return raw === 'bill' || raw === 'date' ? raw : null
}

/**
 * Returns `value` only if it names a bill this household actually has. An id
 * for a deleted rule, another user's id, or anything injected is therefore
 * inert: it can never select or reveal anything.
 */
export function parseBillId(value: QueryValue, billIds: readonly string[]): string | null {
  const raw = firstValue(value)
  if (raw === null) return null
  return billIds.includes(raw) ? raw : null
}

/**
 * Requires a well-formed calendar date within `[today+1, today+180]`. Out of
 * range or malformed returns `null` — a stale shared link falls back to the
 * default rather than silently rewriting the question to "today".
 */
export function parseTargetDate(value: QueryValue, today: IsoDate): IsoDate | null {
  const raw = firstValue(value)
  if (raw === null || !isIsoDate(raw)) return null
  const min = addDays(today, TARGET_MIN_OFFSET_DAYS)
  const max = addDays(today, TARGET_MAX_OFFSET_DAYS)
  if (compareDates(raw, min) < 0 || compareDates(raw, max) > 0) return null
  return raw
}

/** Bill mode needs a bill to point at; without one the screen is in date mode whatever the URL says. */
export function resolveMode(parsed: ShortfallMode | null, hasBills: boolean): ShortfallMode {
  if (parsed === 'bill') return hasBills ? 'bill' : 'date'
  if (parsed === 'date') return 'date'
  return hasBills ? 'bill' : 'date'
}

export function resolveBillId(parsed: string | null, billIds: readonly string[]): string | null {
  return parsed ?? billIds[0] ?? null
}

export function resolveTargetDate(parsed: IsoDate | null, today: IsoDate): IsoDate {
  return parsed ?? addDays(today, TARGET_DEFAULT_OFFSET_DAYS)
}
