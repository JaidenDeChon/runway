import { describe, expect, it } from 'vitest'
import { toMinorUnits } from '~~/domain/money'
import type { DayPoint } from '~~/domain/projection'
import type { ChartLayout } from './burndown'
import {
  DEFAULT_DENSITY,
  DENSITY_BOUNDS,
  dashArrayFor,
  dayBand,
  gridLineYs,
  linePath,
  MOBILE_LAYOUT,
  normalizeDensity,
  percentOf,
  plotHeight,
  plotWidth,
  scaleX,
  scaleY,
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

describe('dashArrayFor', () => {
  it('leaves the first line solid and patterns the rest', () => {
    expect(dashArrayFor(0, DEFAULT_DENSITY)).toBeUndefined()
    expect(dashArrayFor(1, DEFAULT_DENSITY)).toBe('10 10')
    expect(dashArrayFor(2, DEFAULT_DENSITY)).toBe('30 10')
  })

  it('follows the density slider', () => {
    expect(dashArrayFor(1, { ...DEFAULT_DENSITY, dashDensity: 12 })).toBe('12 12')
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
