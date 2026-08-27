/**
 * The golden fixtures, compared verbatim.
 *
 * If one of these fails, the engine's answer to a scenario somebody committed
 * on purpose has changed. That is either a deliberate behaviour change — in
 * which case regenerate (`bun run test:golden:update`), read the diff, and say
 * in the commit what moved and why — or it is the bug this file exists to
 * catch. See `fixtures/README.md`.
 */

import { describe, expect, it } from 'vitest'
import golden from './fixtures/golden.json'
import type { GoldenRecord } from './fixtures/scenarios'
import { GOLDEN_SCENARIOS, snapshot } from './fixtures/scenarios'

const committed = golden as unknown as readonly GoldenRecord[]
const byName = new Map(committed.map((record) => [record.name, record]))

describe('golden fixtures', () => {
  it('has a committed record for every scenario, and no orphans', () => {
    expect(GOLDEN_SCENARIOS.map((scenario) => scenario.name).sort()).toEqual(
      committed.map((record) => record.name).sort(),
    )
  })

  it.each(GOLDEN_SCENARIOS.map((scenario) => [scenario.name, scenario] as const))(
    '%s',
    (name, scenario) => {
      expect(snapshot(scenario)).toEqual(byName.get(name))
    },
  )
})

/**
 * A handful of the fixtures' own claims, spelled out.
 *
 * The comparison above would pass just as happily on a golden file full of
 * wrong numbers that were wrong when they were generated. These assert the
 * things the scenarios are *for*, in a form a reader can check by eye.
 */
describe('what the fixtures are pinning down', () => {
  const record = (name: string): GoldenRecord => {
    const found = byName.get(name)
    if (!found) throw new Error(`no golden record named ${name}`)
    return found
  }

  it('lands a month-end bill on Feb 28 and returns it to Mar 31', () => {
    expect(record('month-boundary-clamp').occurrences).toEqual([
      '2026-01-31 Rent -180000',
      '2026-02-28 Rent -180000',
      '2026-03-31 Rent -180000',
    ])
  })

  it('uses the 29th when February has one, and the 28th when it does not', () => {
    expect(record('leap-day-present').occurrences).toEqual(['2024-02-29 Insurance -12345'])
    expect(record('leap-day-absent').occurrences).toEqual(['2026-02-28 Insurance -12345'])
  })

  it('counts a DST transition day as exactly one day', () => {
    // 2026-03-06 through 2026-03-31 spans the US (Mar 8) and EU (Mar 29)
    // spring-forward dates. 26 calendar days, and no day is skipped or doubled.
    const spring = record('dst-spring-forward')
    expect(spring.window.days).toBe(26)
    expect(spring.combined).toHaveLength(26)
    // Autumn: 2026-10-23 through 2026-11-03, across the EU (Oct 25) and US
    // (Nov 1) fall-back dates and a month boundary.
    expect(record('dst-fall-back').window.days).toBe(12)
  })

  it('nets a bill and income landing on the same day, ordering them by label', () => {
    const sameDay = record('bill-and-income-same-day')
    expect(sameDay.occurrences).toEqual(['2026-02-10 Paycheck 310000', '2026-02-10 Rent -180000'])
    // $1,200 the day before, $2,500 the day of: −$1,800 and +$3,100 together.
    expect(sameDay.combined).toEqual([120_000, 120_000, 250_000, 250_000, 250_000])
  })

  it('carries events that fall between a stale reading and the window', () => {
    const stale = record('stale-reading-with-events')
    // $5,000 read on May 1, then across the unseen fortnight: 14 drained days at
    // 3226c, rent of $1,200 on the 5th and $3,000 of income on the 10th.
    expect(stale.combined[0]).toBe(500_000 - 14 * 3226 - 120_000 + 300_000)
    // Only the in-window event is an occurrence; the other two left no trace
    // beyond the opening balance they moved.
    expect(stale.occurrences).toEqual(['2026-05-18 Card -40000'])
  })

  it('draws a flat line through a window with no events in it', () => {
    const empty = record('empty-window')
    expect(empty.occurrences).toEqual([])
    expect(new Set(empty.combined)).toEqual(new Set([1_314_159]))
  })

  it('answers a projection over nothing at all without special-casing', () => {
    const nothing = record('no-accounts')
    expect(nothing.byAccount).toEqual([])
    expect(nothing.combined).toEqual([0, 0, 0, 0, 0])
    // Not null: with no accounts the combined line is a real, flat $0.
    expect(nothing.combinedLowest).toEqual({ date: '2026-05-01', balance: 0 })
  })
})
