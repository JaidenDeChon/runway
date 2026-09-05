/**
 * Geometry for the burndown chart's SVG.
 *
 * Everything that turns a projected figure into an x/y coordinate lives here,
 * not in the chart's template. Two reasons: a scale is the one part of a chart
 * that can be wrong silently — an off-by-one in the x domain draws a plausible
 * line at the wrong dates — and it is trivially testable once it is a function,
 * which it is not once it is an expression inside a `v-for`.
 *
 * This module never computes a balance. It consumes the `DayPoint[]` the
 * projection engine already produced and maps it into a fixed viewBox; the
 * money is an input, and the output is pixels.
 *
 * Pure TypeScript, no Vue imports, so it runs under the `unit` test project
 * alongside `format.ts` and `navigation.ts`.
 */

import { accountColorVar } from '@/lib/account-colors'
import type { MinorUnits } from '~~/domain/money'
import type { AccountSeries, DayPoint } from '~~/domain/projection'
import type { Account, AccountColor } from '~~/domain/types'

export interface ChartLayout {
  /** viewBox units, not pixels — the SVG is scaled to its container. */
  readonly width: number
  readonly height: number
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

/**
 * Two viewBoxes, one per breakpoint, matching the design's 400/460 unit heights.
 *
 * The widths are chosen so the aspect ratio suits the column each is drawn in;
 * the SVG scales to fit, so these are proportions rather than sizes.
 */
export const MOBILE_LAYOUT: ChartLayout = {
  width: 720,
  height: 400,
  top: 40,
  right: 22,
  bottom: 36,
  left: 22,
}

export const DESKTOP_LAYOUT: ChartLayout = {
  width: 860,
  height: 460,
  top: 44,
  right: 26,
  bottom: 40,
  left: 26,
}

export interface ValueRange {
  readonly min: MinorUnits
  readonly max: MinorUnits
}

/** One drawn line: an account's series, or the combined one. */
export interface ChartSeries {
  readonly id: string
  readonly name: string
  /** A `var(--chart-N)` reference, never a literal colour. */
  readonly stroke: string
  readonly points: readonly DayPoint[]
}

/** One row of the chart legend: the checkbox, the swatch, and the window's closing balance. */
export interface LegendEntry {
  readonly accountId: string
  readonly name: string
  readonly color: AccountColor
  readonly endingBalance: MinorUnits
  readonly checked: boolean
  /** True for the last selected account — deselecting it would empty the chart. */
  readonly disabled: boolean
}

/** The chart-density panel's three live, presentation-only settings. */
export interface ChartDensity {
  readonly lineWeight: number
  readonly dashDensity: number
  readonly markerSize: number
}

/**
 * The range each density setting is allowed to take.
 *
 * The sliders and the validator that screens restored values both read these,
 * so a bound can never be widened in one place and not the other.
 */
export const DENSITY_BOUNDS = {
  lineWeight: { min: 4, max: 14, step: 1 },
  dashDensity: { min: 3, max: 18, step: 1 },
  markerSize: { min: 0.6, max: 1.8, step: 0.1 },
} as const

export const DEFAULT_DENSITY: ChartDensity = { lineWeight: 4, dashDensity: 10, markerSize: 0.9 }

/**
 * Screen a value that claims to be a `ChartDensity` — in practice whatever came
 * back from browser storage, which the user can edit and an older build may have
 * written in a different shape.
 *
 * Returns `null` for anything not shaped like a density so the caller can fall
 * back to the default, and clamps numbers that are the right type but out of
 * range rather than rejecting the whole object over one bad field.
 */
export function normalizeDensity(value: unknown): ChartDensity | null {
  if (typeof value !== 'object' || value === null) return null

  const source = value as Record<string, unknown>
  const keys = ['lineWeight', 'dashDensity', 'markerSize'] as const
  const result = {} as { -readonly [K in (typeof keys)[number]]: number }

  for (const key of keys) {
    const raw = source[key]
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
    const { min, max } = DENSITY_BOUNDS[key]
    result[key] = Math.min(max, Math.max(min, raw))
  }

  return result
}

/**
 * The dash pattern for the *projected* half of the nth drawn line.
 *
 * Dash presence is the past/future channel — history is never dashed — so
 * every index gets a pattern here, unlike the series-identity version this
 * replaces. The pattern still varies by index so two accounts stay tellable
 * apart in the future half without relying on colour.
 */
export function futureDashFor(lineIndex: number, density: ChartDensity): string {
  const dash = density.dashDensity
  // The gap has to clear the stroke, not just follow the slider: a 3-unit gap
  // under a 14-unit stroke is a notch, and at 375px it disappears entirely.
  const gap = Math.max(density.dashDensity, Math.round(density.lineWeight * 1.25))
  if (lineIndex <= 0) return `${dash} ${gap}`
  if (lineIndex === 1) return `${dash * 2} ${gap}`
  return `${dash * 2} ${gap} ${dash} ${gap}`
}

export function plotWidth(layout: ChartLayout): number {
  return layout.width - layout.left - layout.right
}

export function plotHeight(layout: ChartLayout): number {
  return layout.height - layout.top - layout.bottom
}

/** Breathing room above the highest and below the lowest value, as a fraction. */
const RANGE_PADDING = 0.12

/** What a flat series is given for a range, so it draws through the middle. */
const FLAT_RANGE_HALF_SPAN: MinorUnits = 50_000

/**
 * The value range the y-axis must cover.
 *
 * The cushion is always included even when no series comes near it: the danger
 * band is the chart's whole point, and a cushion drawn off-canvas is a band the
 * user cannot see they are above.
 */
export function valueRange(
  series: readonly (readonly DayPoint[])[],
  cushion: MinorUnits,
): ValueRange {
  let min = cushion
  let max = cushion
  for (const points of series) {
    for (const point of points) {
      if (point.balance < min) min = point.balance
      if (point.balance > max) max = point.balance
    }
  }
  if (min === max) return { min: min - FLAT_RANGE_HALF_SPAN, max: max + FLAT_RANGE_HALF_SPAN }
  const padding = Math.round((max - min) * RANGE_PADDING)
  return { min: min - padding, max: max + padding }
}

/**
 * Whether zero falls inside the drawn range — i.e. the forecast crosses from
 * having money to owing it.
 *
 * `docs/design/dashboard/spec.md` Open Question 7 asks whether crossing zero
 * should read differently from crossing the cushion. It should: the cushion is
 * a number the user chose and can move, and zero is not. Without a reference
 * for it, an overdrawn stretch is just "further into the same red band", and
 * the chart never says the one thing a reader most needs to see.
 *
 * The answer stops at a line, though — a second *band* below zero would put
 * two overlapping fills in the same region and make the cushion, the thing the
 * verdict is actually measured against, harder to find. One banded region, two
 * reference lines.
 */
export function containsZero(range: ValueRange): boolean {
  return range.min < 0 && range.max > 0
}

/** The x coordinate of day `index` of `count`. A single day sits at the left edge. */
export function scaleX(index: number, count: number, layout: ChartLayout): number {
  if (count <= 1) return layout.left
  return layout.left + (index * plotWidth(layout)) / (count - 1)
}

/** The y coordinate of a balance. Clamped, so an out-of-range value cannot escape the plot. */
export function scaleY(value: MinorUnits, range: ValueRange, layout: ChartLayout): number {
  const span = range.max - range.min
  if (span <= 0) return layout.top + plotHeight(layout) / 2
  const ratio = (range.max - value) / span
  const clamped = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio
  return layout.top + clamped * plotHeight(layout)
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * A polyline through `points`, whose first point sits at absolute day index
 * `startIndex` of `count`.
 *
 * `startIndex` exists because the previous signature mapped the *slice-local*
 * index: a slice that did not start at day 0 was drawn from the left edge of
 * the plot. A caller drawing a whole series omits it.
 *
 * Straight segments, not a curve: between two events the balance genuinely does
 * not move, and a smoothed line would invent balances the engine never
 * projected — on this screen that is a lie about money.
 */
export function linePath(
  points: readonly DayPoint[],
  range: ValueRange,
  count: number,
  layout: ChartLayout,
  startIndex = 0,
): string {
  if (points.length === 0) return ''
  return points
    .map((point, index) => {
      const x = round(scaleX(startIndex + index, count, layout))
      const y = round(scaleY(point.balance, range, layout))
      return `${index === 0 ? 'M' : 'L'}${x} ${y}`
    })
    .join(' ')
}

/** Two paths through one series, split at `todayIndex` so history and forecast can be drawn differently. */
export interface SplitPath {
  /** Day 0 through `todayIndex` inclusive. `''` when there is no past segment to draw. */
  readonly past: string
  /** `todayIndex` through the last day, inclusive. `''` when there is no future segment. */
  readonly future: string
}

/**
 * Splits one series into a past path (solid) and a future path (dashed), the
 * two joined at `todayIndex` with no gap.
 *
 * The boundary day is deliberately included in **both** slices — that shared
 * vertex is what closes the seam between the two paths. A segment with fewer
 * than two points returns `''` rather than a lone `M x y`: a one-point path
 * renders as a dot under a round linejoin and as nothing under butt caps,
 * either of which is a rendering artifact at exactly the boundary this
 * function exists to make clean.
 */
export function splitSeriesPath(
  points: readonly DayPoint[],
  range: ValueRange,
  count: number,
  layout: ChartLayout,
  todayIndex: number,
): SplitPath {
  if (points.length === 0 || count <= 1) return { past: '', future: '' }
  const clamped = Math.min(Math.max(todayIndex, 0), points.length - 1)
  const pastPoints = points.slice(0, clamped + 1)
  const futurePoints = points.slice(clamped)
  return {
    past: pastPoints.length > 1 ? linePath(pastPoints, range, count, layout, 0) : '',
    future: futurePoints.length > 1 ? linePath(futurePoints, range, count, layout, clamped) : '',
  }
}

/** The invisible hover/tap target for day `index`, half-width at either end. */
export function dayBand(
  index: number,
  count: number,
  layout: ChartLayout,
): { readonly x: number; readonly width: number } {
  if (count <= 1) return { x: layout.left, width: plotWidth(layout) }
  const step = plotWidth(layout) / (count - 1)
  const start = Math.max(layout.left, scaleX(index, count, layout) - step / 2)
  const end = Math.min(layout.left + plotWidth(layout), scaleX(index, count, layout) + step / 2)
  return { x: round(start), width: round(Math.max(end - start, 0)) }
}

/** One day's hit band. */
export interface DayBand {
  readonly x: number
  readonly width: number
}

/** Every day's hit band, computed once per layout change instead of twice per day per render. */
export function dayBands(count: number, layout: ChartLayout): readonly DayBand[] {
  const bands: DayBand[] = []
  for (let index = 0; index < count; index++) {
    bands.push(dayBand(index, count, layout))
  }
  return bands
}

/**
 * Days between x-axis ticks: 7 up to a month, 14 up to two, 21 beyond.
 *
 * A fixed tick count would put labels on arbitrary dates; stepping in whole
 * weeks keeps every tick on the same weekday, which is how the underlying
 * cadences actually repeat.
 */
export function tickStepForHorizon(horizonDays: number): number {
  if (horizonDays <= 30) return 7
  if (horizonDays <= 60) return 14
  return 21
}

/**
 * Tick positions, anchored at `origin` (today) and walked outward.
 *
 * Anchoring at today rather than at the window's first day guarantees a tick on
 * today itself, which is the one date the reader is orienting from.
 */
export function tickIndices(count: number, step: number, origin: number): number[] {
  if (count <= 0 || step <= 0) return []
  const indices: number[] = []
  for (let index = origin % step; index < count; index += step) {
    if (index >= 0) indices.push(index)
  }
  return indices
}

/** Evenly spaced horizontal gridline positions, edges excluded. */
export function gridLineYs(layout: ChartLayout, lines = 4): number[] {
  const ys: number[] = []
  for (let i = 1; i < lines; i++) {
    ys.push(round(layout.top + (plotHeight(layout) * i) / lines))
  }
  return ys
}

/** A coordinate as a percentage of the viewBox, for positioning HTML over the SVG. */
export function percentOf(value: number, total: number): number {
  return round((value / total) * 100)
}

/** Past this fraction of the viewBox width a label must flip left to stay on the card. */
export const LABEL_FLIP_PERCENT = 60

/**
 * Whether a label anchored at day `index` should flip to the left of its
 * point instead of sitting to the right of it, so it cannot run off the card.
 *
 * The same rule the tooltip already uses for its own flip — one function so
 * the two can never disagree.
 */
export function labelFlipsLeft(index: number, count: number, layout: ChartLayout): boolean {
  return percentOf(scaleX(index, count, layout), layout.width) > LABEL_FLIP_PERCENT
}

/** What the chart draws: one line per resolved account, plus the combined line. */
export interface ChartLines {
  /** One entry per projected account that resolves to a known account, in projection order. */
  readonly series: readonly ChartSeries[]
  /** The summed line, present only when two or more account lines are drawn. */
  readonly combined: readonly DayPoint[] | null
  /** What the chart actually draws: `series.length`, plus one when `combined` is present. */
  readonly lineCount: number
}

/**
 * The series-count rule: one line per selected account that still resolves to
 * a known account, plus a combined line only once two or more of those are
 * actually drawn.
 *
 * Keyed off the lines that resolve, not off how many account ids were asked
 * for — those differ only when a selected id has no account behind it, in
 * which case drawing a "combined" of one line was the bug this replaces.
 */
export function chartLines(
  byAccount: readonly AccountSeries[],
  combined: readonly DayPoint[],
  accountsById: ReadonlyMap<string, Account>,
): ChartLines {
  const series: ChartSeries[] = []
  for (const entry of byAccount) {
    const account = accountsById.get(entry.accountId)
    if (!account) continue
    series.push({
      id: account.id,
      name: account.name,
      stroke: accountColorVar(account.color),
      points: entry.points,
    })
  }
  return {
    series,
    combined: series.length > 1 && combined.length > 0 ? combined : null,
    lineCount: series.length + (series.length > 1 && combined.length > 0 ? 1 : 0),
  }
}
