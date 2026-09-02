/**
 * The one dataset every chart-library candidate draws.
 *
 * Issue #10's whole point is comparing candidates fairly, which means they
 * must never each compute their own projection: one `project()` call, once, at
 * module scope, with a fixed `today` — a chart that moved with the wall clock
 * could not be compared across candidates or reviewed twice.
 *
 * `createShortSeedData()` is the household that dips *below* its cushion
 * before the month's mid-point paycheck arrives (see `domain/seed.ts`), which
 * is exactly the shape needed to demonstrate the danger band, the lowest point
 * and a `short` verdict. No `RecurringItem` is hand-written here.
 *
 * This module performs no arithmetic on a balance. Every number below either
 * comes straight out of `project()` / `evaluate()`, or is a colour token.
 */

import { accountColorVar } from '@/lib/account-colors'
import type { ChartSeries } from '@/lib/burndown'
import type { IsoDate } from '~~/domain/dates'
import { addDays } from '~~/domain/dates'
import type { DayPoint, Occurrence, Projection } from '~~/domain/projection'
import { evaluate, project } from '~~/domain/projection'
import { createShortSeedData, SEED_TODAY } from '~~/domain/seed'

/** Matches the dashboard's own look-back — see `app/pages/index.vue`. */
const LOOKBACK_DAYS = 14
const HORIZON_DAYS = 30

const data = createShortSeedData()

const windowStart = addDays(SEED_TODAY, -LOOKBACK_DAYS)
const windowEnd = addDays(SEED_TODAY, HORIZON_DAYS)

export const projection: Projection = project(data, {
  start: windowStart,
  end: windowEnd,
  // A dip already lived through is history, not a forecast — the dashboard's
  // own rule, reproduced here so the fixture's verdict matches what a real
  // screen would show for the same data.
  verdictFrom: addDays(SEED_TODAY, 1),
})

export const cushion = data.safetyCushion

export const days: readonly IsoDate[] = projection.days

export const todayIndex = projection.days.indexOf(SEED_TODAY)

export const horizonDays = HORIZON_DAYS

const verdict = evaluate(projection.combinedSummary, cushion)

export const lowest = verdict.lowest

export const status = verdict.status

/** One line per account, coloured from the account's own token — never a literal. */
export const series: readonly ChartSeries[] = projection.byAccount.flatMap((entry) => {
  const account = data.accounts.find((candidate) => candidate.id === entry.accountId)
  if (!account) return []
  return [
    {
      id: account.id,
      name: account.name,
      stroke: accountColorVar(account.color),
      points: entry.points,
    },
  ]
})

/** The summed line — present because the fixture has two accounts, like the real dashboard. */
export const combined: readonly DayPoint[] | null =
  data.accounts.length > 1 ? projection.combined : null

export const occurrencesByDay: ReadonlyMap<IsoDate, readonly Occurrence[]> = (() => {
  const byDay = new Map<IsoDate, Occurrence[]>()
  for (const occurrence of projection.occurrences) {
    const existing = byDay.get(occurrence.date)
    if (existing) existing.push(occurrence)
    else byDay.set(occurrence.date, [occurrence])
  }
  return byDay
})()
