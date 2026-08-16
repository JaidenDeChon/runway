import { describe, expect, it } from 'vitest'
import { toMinorUnits } from './money'
import type { OccurrenceOverride } from './overrides'
import { applyOverrides, withOverride } from './overrides'
import type { Occurrence } from './projection'
import { evaluate, occurrencesIn, project } from './projection'
import { createSeedData, SEED_TODAY } from './seed'
import type { RunwayData } from './types'

const occurrence = (over: Partial<Occurrence> = {}): Occurrence => ({
  id: 'i@2026-08-20',
  itemId: 'i',
  date: '2026-08-20',
  label: 'Car payment',
  accountId: 'a',
  amount: toMinorUnits(-310),
  isVariable: false,
  isPredicted: false,
  ...over,
})

const override = (over: Partial<OccurrenceOverride> = {}): OccurrenceOverride => ({
  itemId: 'i',
  date: '2026-08-20',
  scope: 'once',
  amount: toMinorUnits(-4496),
  ...over,
})

describe('applyOverrides', () => {
  it('returns the occurrences untouched when there is nothing to apply', () => {
    const occurrences = [occurrence()]
    expect(applyOverrides(occurrences, [])).toEqual(occurrences)
  })

  it('re-prices only the matching occurrence when scoped to one', () => {
    const applied = applyOverrides(
      [occurrence(), occurrence({ id: 'i@2026-09-20', date: '2026-09-20' })],
      [override()],
    )
    expect(applied[0]?.amount).toBe(toMinorUnits(-4496))
    expect(applied[1]?.amount).toBe(toMinorUnits(-310))
  })

  it('re-keys a retimed occurrence so it cannot collide with its neighbour', () => {
    const applied = applyOverrides([occurrence()], [override({ newDate: '2026-08-25' })])
    expect(applied[0]?.date).toBe('2026-08-25')
    expect(applied[0]?.id).toBe('i@2026-08-25')
  })

  it('leaves other items alone', () => {
    const applied = applyOverrides([occurrence({ itemId: 'other' })], [override()])
    expect(applied[0]?.amount).toBe(toMinorUnits(-310))
  })

  it('rewrites every occurrence at or after the date when scoped to the future', () => {
    const applied = applyOverrides(
      [
        occurrence({ id: 'i@2026-07-20', date: '2026-07-20' }),
        occurrence(),
        occurrence({ id: 'i@2026-09-20', date: '2026-09-20' }),
      ],
      [override({ scope: 'future' })],
    )
    expect(applied.map((entry) => entry.amount)).toEqual([
      toMinorUnits(-310),
      toMinorUnits(-4496),
      toMinorUnits(-4496),
    ])
  })

  it('ignores the date on a future-scoped override', () => {
    const applied = applyOverrides(
      [occurrence()],
      [override({ scope: 'future', newDate: '2026-08-25' })],
    )
    expect(applied[0]?.date).toBe('2026-08-20')
  })

  it('lets a later override win, so a what-if previews on top of a saved edit', () => {
    const applied = applyOverrides(
      [occurrence()],
      [override({ amount: toMinorUnits(-4496) }), override({ amount: toMinorUnits(-6000) })],
    )
    expect(applied[0]?.amount).toBe(toMinorUnits(-6000))
  })
})

describe('withOverride', () => {
  it('replaces an earlier edit of the same occurrence rather than stacking', () => {
    const list = withOverride([override()], override({ amount: toMinorUnits(-6000) }))
    expect(list).toHaveLength(1)
    expect(list[0]?.amount).toBe(toMinorUnits(-6000))
  })

  it('keeps edits of different occurrences side by side', () => {
    const list = withOverride([override()], override({ date: '2026-09-20' }))
    expect(list).toHaveLength(2)
  })
})

describe('project with overrides', () => {
  const seeded: RunwayData = createSeedData()
  const window = { start: '2026-08-01', end: '2026-09-14' }

  it('moves the balance series without touching the stored records', () => {
    const before = project(seeded, window)
    const after = project(seeded, {
      ...window,
      overrides: [
        {
          itemId: 'item-car-payment',
          date: '2026-08-20',
          scope: 'once',
          amount: toMinorUnits(-6000),
        },
      ],
    })
    const last = (points: readonly { balance: number }[]) => points[points.length - 1]?.balance ?? 0
    expect(last(after.combined)).toBe(last(before.combined) - toMinorUnits(5690))
    // The seed is untouched: an override is a lens, not a mutation.
    expect(seeded.recurringItems.find((item) => item.id === 'item-car-payment')?.amount).toBe(
      toMinorUnits(310),
    )
  })

  it('keeps the occurrence list sorted after a retime', () => {
    const occurrences = occurrencesIn(seeded, {
      ...window,
      overrides: [
        {
          itemId: 'item-car-payment',
          date: '2026-08-20',
          scope: 'once',
          amount: toMinorUnits(-310),
          newDate: '2026-09-10',
        },
      ],
    })
    const dates = occurrences.map((entry) => entry.date)
    expect([...dates].sort()).toEqual(dates)
    expect(dates).toContain('2026-09-10')
  })
})

describe('evaluate shortfall', () => {
  const points = [
    { date: SEED_TODAY, balance: toMinorUnits(1000) },
    { date: '2026-08-16', balance: toMinorUnits(-804) },
  ]

  it('reports the gap below the cushion as a positive magnitude', () => {
    expect(evaluate(points, toMinorUnits(600)).shortfall).toBe(toMinorUnits(1404))
  })

  it('is zero whenever the cushion holds', () => {
    expect(evaluate(points, toMinorUnits(-2000)).shortfall).toBe(0)
  })
})
