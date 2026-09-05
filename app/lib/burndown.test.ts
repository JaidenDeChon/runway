import { describe, expect, it } from 'vitest'
import { toMinorUnits } from '~~/domain/money'
import type { AccountSeries, DayPoint } from '~~/domain/projection'
import type { Account } from '~~/domain/types'
import type { ChartLayout } from './burndown'
import {
  chartLines,
  containsZero,
  DEFAULT_DENSITY,
  DENSITY_BOUNDS,
  dayBand,
  dayBands,
  futureDashFor,
  gridLineYs,
  LABEL_FLIP_PERCENT,
  labelFlipsLeft,
  linePath,
  MOBILE_LAYOUT,
  normalizeDensity,
  percentOf,
  plotHeight,
  plotWidth,
  scaleX,
  scaleY,
  splitSeriesPath,
  tickIndices,
  tickStepForHorizon,
  valueRange,
} from './burndown'

const layout: ChartLayout = { width: 100, height: 100, top: 10, right: 10, bottom: 10, left: 10 }

const points = (...balances: number[]): DayPoint[] =>
  balances.map((balance, index) => ({
    date: `2026-08-${String(index + 1).padStart(2, '0')}`,
    balance: toMinorUnits(balance),
  }))

describe('containsZero', () => {
  it('is true only when the forecast actually crosses from having money to owing it', () => {
    expect(containsZero({ min: toMinorUnits(-500), max: toMinorUnits(200) })).toBe(true)
    expect(containsZero({ min: toMinorUnits(100), max: toMinorUnits(900) })).toBe(false)
    expect(containsZero({ min: toMinorUnits(-900), max: toMinorUnits(-100) })).toBe(false)
  })

  it('does not treat a range that merely touches zero as a crossing', () => {
    // A forecast that bottoms out at exactly $0 is not overdrawn, and a
    // reference line drawn on top of the series would say it was.
    expect(containsZero({ min: 0, max: toMinorUnits(900) })).toBe(false)
    expect(containsZero({ min: toMinorUnits(-900), max: 0 })).toBe(false)
  })

  it('is satisfied by a wholly-negative series once a non-negative cushion widens the range', () => {
    // The cushion is always inside the range (see `valueRange`), and the
    // cushion is never negative, so an overdrawn forecast always has a zero
    // to draw against — this is what the chart relies on.
    const range = valueRange([points(-500, -200)], toMinorUnits(300))
    expect(range.max).toBeGreaterThan(0)
    expect(containsZero(range)).toBe(true)
  })
})

describe('valueRange', () => {
  it('always covers the cushion, even when no series comes near it', () => {
    const range = valueRange([points(5000, 6000)], toMinorUnits(600))
    expect(range.min).toBeLessThan(toMinorUnits(600))
  })

  it('pads above the peak and below the trough', () => {
    const range = valueRange([points(0, 1000)], 0)
    expect(range.min).toBeLessThan(0)
    expect(range.max).toBeGreaterThan(toMinorUnits(1000))
  })

  it('gives a flat series a span so it draws through the middle', () => {
    const range = valueRange([points(1000, 1000)], toMinorUnits(1000))
    expect(range.max).toBeGreaterThan(range.min)
    expect(scaleY(toMinorUnits(1000), range, layout)).toBe(layout.top + plotHeight(layout) / 2)
  })
})

describe('scaleX', () => {
  it('puts the first day on the left edge and the last on the right', () => {
    expect(scaleX(0, 5, layout)).toBe(10)
    expect(scaleX(4, 5, layout)).toBe(10 + plotWidth(layout))
  })

  it('collapses a single day onto the left edge instead of dividing by zero', () => {
    expect(scaleX(0, 1, layout)).toBe(10)
  })
})

describe('scaleY', () => {
  const range = { min: 0, max: toMinorUnits(100) }

  it('inverts the axis — the maximum is at the top', () => {
    expect(scaleY(toMinorUnits(100), range, layout)).toBe(10)
    expect(scaleY(0, range, layout)).toBe(10 + plotHeight(layout))
  })

  it('clamps a value outside the range into the plot', () => {
    expect(scaleY(toMinorUnits(500), range, layout)).toBe(10)
    expect(scaleY(toMinorUnits(-500), range, layout)).toBe(10 + plotHeight(layout))
  })
})

describe('linePath', () => {
  it('emits one move and then a line per day', () => {
    const path = linePath(points(0, 100), { min: 0, max: toMinorUnits(100) }, 2, layout)
    expect(path).toBe('M10 90 L90 10')
  })

  it('is empty for an empty series', () => {
    expect(linePath([], { min: 0, max: 1 }, 0, layout)).toBe('')
  })

  it('offsets by startIndex instead of always drawing from the left edge', () => {
    // Regression for Trap A: a slice that does not start at day 0 must be
    // drawn at its own absolute position, not re-anchored to the plot's edge.
    const range = { min: 0, max: toMinorUnits(100) }
    const sliced = linePath(points(0, 100, 50), range, 6, layout, 3)
    expect(sliced).toBe(
      `M${scaleX(3, 6, layout)} ${scaleY(0, range, layout)} ` +
        `L${scaleX(4, 6, layout)} ${scaleY(toMinorUnits(100), range, layout)} ` +
        `L${scaleX(5, 6, layout)} ${scaleY(toMinorUnits(50), range, layout)}`,
    )
    expect(sliced).not.toContain(`M${layout.left}`)
  })
})

describe('splitSeriesPath', () => {
  const range = { min: 0, max: toMinorUnits(100) }

  it('shares exactly one vertex between the two halves, closing the seam', () => {
    const series = points(10, 20, 30, 40, 50)
    const { past, future } = splitSeriesPath(series, range, 5, layout, 2)
    // The last coordinate pair of `past` and the first of `future` are both
    // day index 2's point — that shared vertex is what closes the gap.
    const pastTokens = past.split(' ')
    const [pastX, pastY] = pastTokens.slice(-2)
    const [futureX, futureY] = future.split(' ')
    expect(pastX?.replace(/^[ML]/, '')).toBe(futureX?.replace(/^[ML]/, ''))
    expect(pastY).toBe(futureY)
  })

  it('draws the whole series as future when todayIndex is 0', () => {
    const series = points(10, 20, 30)
    const { past, future } = splitSeriesPath(series, range, 3, layout, 0)
    expect(past).toBe('')
    expect(future).toBe(linePath(series, range, 3, layout, 0))
  })

  it('draws the whole series as past when todayIndex is the last day', () => {
    const series = points(10, 20, 30)
    const { past, future } = splitSeriesPath(series, range, 3, layout, 2)
    expect(future).toBe('')
    expect(past).toBe(linePath(series, range, 3, layout, 0))
  })

  it('clamps a todayIndex outside the series into range', () => {
    const series = points(10, 20, 30)
    expect(splitSeriesPath(series, range, 3, layout, -5)).toEqual(
      splitSeriesPath(series, range, 3, layout, 0),
    )
    expect(splitSeriesPath(series, range, 3, layout, 99)).toEqual(
      splitSeriesPath(series, range, 3, layout, 2),
    )
  })

  it('is empty for an empty series', () => {
    expect(splitSeriesPath([], range, 0, layout, 0)).toEqual({ past: '', future: '' })
  })
})

describe('dayBand', () => {
  it('gives the end days a half-width band clipped to the plot', () => {
    const first = dayBand(0, 5, layout)
    expect(first.x).toBe(10)
    expect(first.width).toBe(plotWidth(layout) / 8)
  })

  it('centres an interior band on its day', () => {
    const band = dayBand(2, 5, layout)
    expect(band.x + band.width / 2).toBeCloseTo(scaleX(2, 5, layout), 5)
  })
})

describe('dayBands', () => {
  it('computes one band per day, matching dayBand entry for entry', () => {
    const bands = dayBands(5, layout)
    expect(bands).toHaveLength(5)
    for (let index = 0; index < 5; index++) {
      expect(bands[index]).toEqual(dayBand(index, 5, layout))
    }
  })
})

describe('tickStepForHorizon', () => {
  it('steps a week up to a month, a fortnight up to two, three weeks beyond', () => {
    expect(tickStepForHorizon(30)).toBe(7)
    expect(tickStepForHorizon(60)).toBe(14)
    expect(tickStepForHorizon(90)).toBe(21)
  })
})

describe('tickIndices', () => {
  it('always lands a tick on the origin day', () => {
    expect(tickIndices(45, 7, 14)).toContain(14)
  })

  it('stays inside the series', () => {
    const indices = tickIndices(10, 7, 14)
    expect(Math.max(...indices)).toBeLessThan(10)
  })
})

describe('gridLineYs', () => {
  it('draws the interior lines only', () => {
    expect(gridLineYs(layout, 4)).toEqual([30, 50, 70])
  })
})

describe('futureDashFor', () => {
  it('never returns undefined — history is never dashed, but the future always is', () => {
    expect(futureDashFor(0, DEFAULT_DENSITY)).toBeTypeOf('string')
    expect(futureDashFor(1, DEFAULT_DENSITY)).toBeTypeOf('string')
    expect(futureDashFor(2, DEFAULT_DENSITY)).toBeTypeOf('string')
  })

  it('varies the pattern across index 0/1/2+ so lines stay tellable apart without colour', () => {
    const a = futureDashFor(0, DEFAULT_DENSITY)
    const b = futureDashFor(1, DEFAULT_DENSITY)
    const c = futureDashFor(2, DEFAULT_DENSITY)
    expect(a).not.toBe(b)
    expect(b).not.toBe(c)
    expect(a).not.toBe(c)
  })

  it('the on-length follows the dash density slider', () => {
    expect(futureDashFor(0, { ...DEFAULT_DENSITY, dashDensity: 12 })).toBe('12 12')
  })

  it('floors the gap at lineWeight * 1.25 so a thin dash cannot vanish under a heavy stroke', () => {
    // dashDensity 3 alone would give a gap narrower than the 14-unit stroke —
    // AC63-5's failing combination.
    const dash = futureDashFor(0, { ...DEFAULT_DENSITY, dashDensity: 3, lineWeight: 14 })
    expect(dash).toBe('3 18')
  })
})

describe('percentOf', () => {
  it('maps a viewBox coordinate onto its container', () => {
    expect(percentOf(scaleX(0, 2, MOBILE_LAYOUT), MOBILE_LAYOUT.width)).toBeCloseTo(3.06, 1)
  })
})

describe('normalizeDensity', () => {
  it('accepts a well-formed density unchanged', () => {
    const value = { lineWeight: 9, dashDensity: 5, markerSize: 1.2 }
    expect(normalizeDensity(value)).toEqual(value)
  })

  it('accepts the default', () => {
    expect(normalizeDensity(DEFAULT_DENSITY)).toEqual(DEFAULT_DENSITY)
  })

  it('clamps numbers that are out of range rather than discarding the object', () => {
    expect(normalizeDensity({ lineWeight: 999, dashDensity: -4, markerSize: 12 })).toEqual({
      lineWeight: DENSITY_BOUNDS.lineWeight.max,
      dashDensity: DENSITY_BOUNDS.dashDensity.min,
      markerSize: DENSITY_BOUNDS.markerSize.max,
    })
  })

  it('rejects anything not shaped like a density', () => {
    expect(normalizeDensity(null)).toBeNull()
    expect(normalizeDensity('8')).toBeNull()
    expect(normalizeDensity({})).toBeNull()
    expect(normalizeDensity({ lineWeight: 8, dashDensity: 7 })).toBeNull()
    expect(normalizeDensity({ lineWeight: '8', dashDensity: 7, markerSize: 1 })).toBeNull()
  })

  it('rejects non-finite numbers, which clamping would otherwise let through', () => {
    expect(normalizeDensity({ lineWeight: Number.NaN, dashDensity: 7, markerSize: 1 })).toBeNull()
    expect(
      normalizeDensity({ lineWeight: Number.POSITIVE_INFINITY, dashDensity: 7, markerSize: 1 }),
    ).toBeNull()
  })
})

describe('DEFAULT_DENSITY', () => {
  it('sits within the bounds the sliders offer', () => {
    for (const key of ['lineWeight', 'dashDensity', 'markerSize'] as const) {
      expect(DEFAULT_DENSITY[key]).toBeGreaterThanOrEqual(DENSITY_BOUNDS[key].min)
      expect(DEFAULT_DENSITY[key]).toBeLessThanOrEqual(DENSITY_BOUNDS[key].max)
    }
  })
})

describe('labelFlipsLeft', () => {
  it('does not flip at the start of the plot', () => {
    expect(labelFlipsLeft(0, 10, layout)).toBe(false)
  })

  it('flips at the end of the plot', () => {
    expect(labelFlipsLeft(9, 10, layout)).toBe(true)
  })

  it('shares its boundary with the tooltip flip, at LABEL_FLIP_PERCENT of the width', () => {
    // left/right 0 makes scaleX(index, count, layout) read directly as a
    // percentage of the width when count - 1 === width.
    const wide: ChartLayout = { width: 100, height: 100, top: 0, right: 0, bottom: 0, left: 0 }
    expect(labelFlipsLeft(LABEL_FLIP_PERCENT, 101, wide)).toBe(false)
    expect(labelFlipsLeft(LABEL_FLIP_PERCENT + 1, 101, wide)).toBe(true)
  })
})

describe('chartLines', () => {
  const accountPoints = (id: string): AccountSeries => ({
    accountId: id,
    points: points(1000, 2000),
    summary: { lowest: null, ending: toMinorUnits(2000) },
  })

  const account = (id: string, color: Account['color']): Account => ({
    id,
    name: id,
    balance: toMinorUnits(1000),
    balanceAsOf: '2026-08-01',
    color,
    isDiscretionarySource: false,
  })

  it('draws nothing for zero accounts — an unreachable but defensive data state', () => {
    const result = chartLines([], [], new Map())
    expect(result).toEqual({ series: [], combined: null, lineCount: 0 })
  })

  it('draws one line and no combined for a single account', () => {
    const accountsById = new Map([['a', account('a', 'chart-2')]])
    const result = chartLines([accountPoints('a')], points(2000, 4000), accountsById)
    expect(result.series).toHaveLength(1)
    expect(result.combined).toBeNull()
    expect(result.lineCount).toBe(1)
  })

  it('draws a combined line once two accounts resolve', () => {
    const accountsById = new Map([
      ['a', account('a', 'chart-2')],
      ['b', account('b', 'chart-3')],
    ])
    const result = chartLines(
      [accountPoints('a'), accountPoints('b')],
      points(2000, 4000),
      accountsById,
    )
    expect(result.series).toHaveLength(2)
    expect(result.combined).not.toBeNull()
    expect(result.lineCount).toBe(3)
  })

  it('keeps counting up for a third account', () => {
    const accountsById = new Map([
      ['a', account('a', 'chart-2')],
      ['b', account('b', 'chart-3')],
      ['c', account('c', 'chart-4')],
    ])
    const result = chartLines(
      [accountPoints('a'), accountPoints('b'), accountPoints('c')],
      points(2000, 4000),
      accountsById,
    )
    expect(result.series).toHaveLength(3)
    expect(result.lineCount).toBe(4)
  })

  it('drops an account id that has no entry in accountsById, and does not count it', () => {
    const accountsById = new Map([['a', account('a', 'chart-2')]])
    const result = chartLines(
      [accountPoints('a'), accountPoints('ghost')],
      points(2000, 4000),
      accountsById,
    )
    expect(result.series).toHaveLength(1)
    expect(result.series[0]?.id).toBe('a')
    expect(result.combined).toBeNull()
    expect(result.lineCount).toBe(1)
  })
})
