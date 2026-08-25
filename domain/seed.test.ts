/**
 * The seeded households are what the screens actually render, so what they
 * *demonstrate* is a property worth holding.
 *
 * `createSeedData` is the comfortable household and `createShortSeedData` is
 * the one the shortfall screen exists for. Between them they have to cover both
 * verdicts, or half the app's states have no data behind them — which was the
 * situation before the short household existed: every "Short" band, every
 * "you're $X short on the 14th", was reachable only by hand-editing a balance.
 *
 * These are assertions about a fixture rather than about the engine, and that is
 * deliberate. A fixture that quietly stops demonstrating what its comment claims
 * is not a failing test anywhere else — it is a screenshot that looks wrong
 * eighteen months later and nobody knows why.
 */

import { describe, expect, it } from 'vitest'
import { addDays, compareDates, type IsoDate } from './dates'
import { evaluate, project, shortfallThrough } from './projection'
import { createSeedData, createShortSeedData, SEED_TODAY } from './seed'
import type { RunwayData } from './types'

/** The horizons the dashboard's toggle offers. */
const HORIZONS = [30, 60, 90] as const

/** The design's look-back, so these windows are the ones the dashboard asks for. */
const LOOKBACK_DAYS = 14

/**
 * A long sweep of "todays", not a handful.
 *
 * Every day for well over a year, which walks the fixture through every month
 * length, both February variants, and every phase of a semi-monthly paycheck.
 * A fixture that is short only in August is not a short fixture.
 */
const ANCHORS: readonly IsoDate[] = Array.from({ length: 400 }, (_, offset) =>
  addDays(SEED_TODAY, offset),
)

function verdictAt(data: RunwayData, today: IsoDate, horizonDays: number) {
  const projection = project(data, {
    start: addDays(today, -LOOKBACK_DAYS),
    end: addDays(today, horizonDays),
    // What the dashboard passes: a dip that has already happened is history.
    verdictFrom: addDays(today, 1),
  })
  return { ...evaluate(projection.combinedSummary, data.safetyCushion), projection }
}

describe('the short household', () => {
  const data = createShortSeedData()

  it('is short at every horizon the dashboard offers, on every day for over a year', () => {
    const notShort: string[] = []
    for (const today of ANCHORS) {
      for (const horizonDays of HORIZONS) {
        const verdict = verdictAt(data, today, horizonDays)
        if (verdict.status !== 'short') {
          notShort.push(
            `${today} @${horizonDays}d: ${verdict.status}, low ${verdict.lowest?.balance} on ${verdict.lowest?.date}`,
          )
        }
      }
    }
    expect(notShort).toEqual([])
  })

  it('never climbs out — it is still short years later', () => {
    // The bleed is structural: $2,124 of income against $2,176 of bills and
    // discretionary spending. A fixture that recovers stops being a short
    // fixture some months after the day it was written, silently.
    for (const today of ['2028-08-15', '2030-01-01', '2031-06-30'] as const) {
      expect(verdictAt(data, today, 90).status).toBe('short')
    }
  })

  it('puts the low point in the future, where the verdict is looking', () => {
    for (const today of ANCHORS) {
      const { lowest } = verdictAt(data, today, 30)
      expect(lowest).not.toBeNull()
      // `verdictFrom` is today + 1: a dip inside the look-back is history and
      // must not be what the card reports.
      expect(compareDates(lowest?.date ?? today, addDays(today, 1))).toBeGreaterThanOrEqual(0)
    }
  })

  it('dips below the cushion before the paycheck that would lift it back', () => {
    // The shape the shortfall screen exists for: a window that *closes* well
    // above the cushion and still bounces in the middle. Reading the endpoint
    // alone answers "yes, you make it" about a month the user does not make.
    const { lowest, projection } = verdictAt(data, '2026-09-20', 30)
    expect(projection.combinedSummary.ending).toBeGreaterThan(lowest?.balance ?? 0)
    expect(projection.combinedSummary.ending).toBeGreaterThan(data.safetyCushion)
    expect(lowest?.balance ?? 0).toBeLessThan(data.safetyCushion)
  })

  it('reports a shortfall that is exact to the cent, at every horizon', () => {
    // The figure the screen prints is a promise: top the account up by exactly
    // this and the cushion holds; by one cent less and it does not. Asserted
    // against the fixture, so the promise is checked on the data users see.
    for (const horizonDays of HORIZONS) {
      const through = addDays(SEED_TODAY, horizonDays)
      const answer = shortfallThrough(data, {
        today: SEED_TODAY,
        through,
        cushion: data.safetyCushion,
      })
      expect(answer.isCovered).toBe(false)
      expect(answer.shortfall).toBeGreaterThan(0)

      const toppedUp = (extra: number): RunwayData => ({
        ...data,
        accounts: data.accounts.map((account) =>
          account.isDiscretionarySource
            ? { ...account, balance: account.balance + extra }
            : account,
        ),
      })
      const exact = shortfallThrough(toppedUp(answer.shortfall), {
        today: SEED_TODAY,
        through,
        cushion: data.safetyCushion,
      })
      expect(exact.isCovered).toBe(true)
      expect(exact.margin).toBe(0)

      const oneCentShy = shortfallThrough(toppedUp(answer.shortfall - 1), {
        today: SEED_TODAY,
        through,
        cushion: data.safetyCushion,
      })
      expect(oneCentShy.isCovered).toBe(false)
      expect(oneCentShy.shortfall).toBe(1)
    }
  })

  it('gets worse with a longer horizon, never better', () => {
    // Why being short inside the first month is enough: the running minimum can
    // only fall as the window lengthens. If this ever inverted, "short at 30"
    // would stop implying "short at 60", and the sweep above would be proving
    // less than it claims.
    for (const today of ANCHORS) {
      const lows = HORIZONS.map((horizonDays) => verdictAt(data, today, horizonDays).margin)
      expect(lows[1]).toBeLessThanOrEqual(lows[0] as number)
      expect(lows[2]).toBeLessThanOrEqual(lows[1] as number)
    }
  })

  it('drains the account the discretionary spend is flagged against', () => {
    // One source, and it is the one holding the bills. A fixture whose
    // discretionary flag drifted to Savings would still be short, and would be
    // short for the wrong reason.
    const source = data.accounts.filter((account) => account.isDiscretionarySource)
    expect(source.map((account) => account.name)).toEqual(['Checking'])
    expect(data.monthlyDiscretionarySpend).toBeGreaterThan(0)
    expect(
      data.recurringItems.every((item) =>
        data.accounts.some((account) => account.id === item.accountId),
      ),
    ).toBe(true)
  })
})

describe('the comfortable household', () => {
  const data = createSeedData()

  it('is covered at every horizon, so the two fixtures cover both verdicts', () => {
    for (const horizonDays of HORIZONS) {
      expect(verdictAt(data, SEED_TODAY, horizonDays).status).toBe('covered')
    }
  })
})
