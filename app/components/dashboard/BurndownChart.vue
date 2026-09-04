<script setup lang="ts">
/**
 * The balance forecast, as an inline SVG.
 *
 * Bespoke because there is no chart primitive in the shadcn-vue registry and a
 * charting library would be a large dependency for one screen. It draws and
 * nothing else: every coordinate comes from `app/lib/burndown.ts`, and every
 * figure comes from the projection engine already computed. There is no
 * arithmetic on money anywhere in this file.
 *
 * Three things the static design export could not show, built from the prose:
 *
 * - **The crosshair and tooltip are not pointer-only.** The same `activeIndex`
 *   drives them whether it was set by a mouse or by the arrow keys, so a
 *   keyboard user gets the daily balances that otherwise exist only on hover.
 * - **The SVG is focusable** and navigates day by day, announcing each date and
 *   balance through a live region, because the export's per-day hit rects were
 *   `<rect>`s with a click handler and nothing else.
 * - **The whole chart carries a text summary** naming the trend and the low
 *   point, since colour and position are otherwise the only things saying it.
 */
import { computed, ref } from 'vue'
import MoneyText from '@/components/MoneyText.vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import type { ChartDensity, ChartSeries } from '@/lib/burndown'
import {
  containsZero,
  DESKTOP_LAYOUT,
  dayBands,
  futureDashFor,
  gridLineYs,
  labelFlipsLeft,
  MOBILE_LAYOUT,
  percentOf,
  scaleX,
  scaleY,
  splitSeriesPath,
  tickIndices,
  tickStepForHorizon,
  valueRange,
} from '@/lib/burndown'
import { formatDateShort, formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { IsoDate } from '~~/domain/dates'
import type { MinorUnits } from '~~/domain/money'
import type { DayPoint, LowestPoint, Occurrence, RunwayStatus } from '~~/domain/projection'

const props = defineProps<{
  days: readonly IsoDate[]
  /** One entry per selected account, in legend order. */
  series: readonly ChartSeries[]
  /** The summed line, present only when two or more accounts are selected. */
  combined: readonly DayPoint[] | null
  occurrencesByDay: ReadonlyMap<IsoDate, readonly Occurrence[]>
  cushion: MinorUnits
  todayIndex: number
  lowest: LowestPoint | null
  status: RunwayStatus
  density: ChartDensity
  horizonDays: number
  /** Drives the taller viewBox; the Sheet→Dialog swap fires at the same breakpoint. */
  desktop: boolean
}>()

const emit = defineEmits<{ selectDay: [date: IsoDate] }>()

const layout = computed(() => (props.desktop ? DESKTOP_LAYOUT : MOBILE_LAYOUT))
const count = computed(() => props.days.length)

/** The line the verdict was read from — combined when it exists, else the only account. */
const verdictSeries = computed<readonly DayPoint[]>(
  () => props.combined ?? props.series[0]?.points ?? [],
)

const range = computed(() =>
  valueRange([...props.series.map((entry) => entry.points), verdictSeries.value], props.cushion),
)

const cushionY = computed(() => scaleY(props.cushion, range.value, layout.value))
const zeroY = computed(() => scaleY(0, range.value, layout.value))

/**
 * The zero reference, drawn only when the forecast actually crosses it — and
 * never when the cushion is itself zero, where the cushion line already marks
 * the spot and a second line on the same pixels would just look like a
 * rendering bug. See `containsZero` for why zero earns a line of its own.
 */
const showZeroLine = computed(() => containsZero(range.value) && props.cushion !== 0)
const plotBottom = computed(() => layout.value.height - layout.value.bottom)
const todayX = computed(() => scaleX(props.todayIndex, count.value, layout.value))

const gridLines = computed(() => gridLineYs(layout.value))

interface DrawnLine {
  readonly key: string
  /** Always a `var(--chart-N)` reference, never a literal colour. */
  readonly stroke: string
  readonly width: number
  readonly dash: string
  readonly past: string
  readonly future: string
}

/**
 * Every line the chart draws, in paint order: accounts first, combined last,
 * so the heavier combined line stays on top — unchanged from before the
 * split. Combined is dash index `0` (the simplest, most even pattern, for the
 * primary line); an account's dash index shifts by one once a combined line
 * exists, so the two never share a pattern.
 */
const drawnLines = computed<DrawnLine[]>(() => {
  const lines: DrawnLine[] = props.series.map((entry, index) => {
    const dashIndex = index + (props.combined ? 1 : 0)
    const split = splitSeriesPath(
      entry.points,
      range.value,
      count.value,
      layout.value,
      props.todayIndex,
    )
    return {
      key: entry.id,
      stroke: entry.stroke,
      width: props.combined ? props.density.lineWeight * 0.55 : props.density.lineWeight,
      dash: futureDashFor(dashIndex, props.density),
      past: split.past,
      future: split.future,
    }
  })
  if (props.combined) {
    const split = splitSeriesPath(
      props.combined,
      range.value,
      count.value,
      layout.value,
      props.todayIndex,
    )
    lines.push({
      key: 'combined',
      stroke: 'var(--chart-1)',
      width: props.density.lineWeight,
      dash: futureDashFor(0, props.density),
      past: split.past,
      future: split.future,
    })
  }
  return lines
})

/** Every day's hit band, computed once per layout change rather than twice per day per render. */
const bands = computed(() => dayBands(count.value, layout.value))

interface Marker {
  readonly key: string
  readonly cx: number
  readonly cy: number
  readonly stroke: string
  /** Income days are filled, bill days hollow — the sign, not just the colour. */
  readonly filled: boolean
}

/** Markers sit only on days something actually lands, which is what makes them readable. */
const markers = computed<Marker[]>(() => {
  const result: Marker[] = []
  for (const [index, date] of props.days.entries()) {
    const onDay = props.occurrencesByDay.get(date)
    if (!onDay || onDay.length === 0) continue
    for (const entry of props.series) {
      const forAccount = onDay.filter((occurrence) => occurrence.accountId === entry.id)
      if (forAccount.length === 0) continue
      const point = entry.points[index]
      if (!point) continue
      result.push({
        key: `${entry.id}-${date}`,
        cx: scaleX(index, count.value, layout.value),
        cy: scaleY(point.balance, range.value, layout.value),
        stroke: entry.stroke,
        filled: forAccount.some((occurrence) => occurrence.amount > 0),
      })
    }
    const combinedPoint = props.combined?.[index]
    if (combinedPoint) {
      result.push({
        key: `combined-${date}`,
        cx: scaleX(index, count.value, layout.value),
        cy: scaleY(combinedPoint.balance, range.value, layout.value),
        stroke: 'var(--chart-1)',
        filled: onDay.some((occurrence) => occurrence.amount > 0),
      })
    }
  }
  return result
})

const lowestIndex = computed(() => (props.lowest ? props.days.indexOf(props.lowest.date) : -1))

const lowestMarker = computed(() => {
  if (lowestIndex.value < 0 || !props.lowest) return null
  return {
    cx: scaleX(lowestIndex.value, count.value, layout.value),
    cy: scaleY(props.lowest.balance, range.value, layout.value),
  }
})

/** Past 60% of the width the label would run off the card, so it flips to the marker's left. */
const lowestFlipped = computed(() => labelFlipsLeft(lowestIndex.value, count.value, layout.value))

const ticks = computed(() =>
  tickIndices(count.value, tickStepForHorizon(props.horizonDays), props.todayIndex).map(
    (index) => ({
      index,
      date: props.days[index] as IsoDate,
      leftPct: percentOf(scaleX(index, count.value, layout.value), layout.value.width),
    }),
  ),
)

/* ---- crosshair, tooltip and keyboard navigation ---- */

const activeIndex = ref<number | null>(null)

const activeDate = computed<IsoDate | null>(() =>
  activeIndex.value === null ? null : (props.days[activeIndex.value] ?? null),
)

const activeX = computed(() =>
  activeIndex.value === null ? 0 : scaleX(activeIndex.value, count.value, layout.value),
)

/** Past 60% of the width the tooltip would run off the card, so it flips. */
const tooltipFlipped = computed(() => percentOf(activeX.value, layout.value.width) > 60)

interface TooltipRow {
  readonly key: string
  readonly name: string
  readonly stroke: string
  readonly balance: MinorUnits
}

const tooltipRows = computed<TooltipRow[]>(() => {
  const index = activeIndex.value
  if (index === null) return []
  const rows: TooltipRow[] = props.series.flatMap((entry) => {
    const point = entry.points[index]
    return point
      ? [{ key: entry.id, name: entry.name, stroke: entry.stroke, balance: point.balance }]
      : []
  })
  const combinedPoint = props.combined?.[index]
  if (combinedPoint) {
    rows.push({
      key: 'combined',
      name: 'Combined',
      stroke: 'var(--chart-1)',
      balance: combinedPoint.balance,
    })
  }
  return rows
})

const tooltipOccurrences = computed<readonly Occurrence[]>(() =>
  activeDate.value ? (props.occurrencesByDay.get(activeDate.value) ?? []) : [],
)

function dayLabel(date: IsoDate, index: number): string {
  return index === props.todayIndex ? `${formatDateShort(date)} · Today` : formatDateShort(date)
}

const activeLabel = computed(() =>
  activeDate.value === null || activeIndex.value === null
    ? ''
    : dayLabel(activeDate.value, activeIndex.value),
)

/** What the live region says as the arrow keys walk the series. */
const announcement = computed(() => {
  if (activeIndex.value === null || activeDate.value === null) return ''
  const balances = tooltipRows.value
    .map((row) => `${row.name} ${formatMoney(row.balance)}`)
    .join(', ')
  const events = tooltipOccurrences.value
    .map((occurrence) => `${occurrence.label} ${formatMoney(occurrence.amount)}`)
    .join(', ')
  const day = activeLabel.value
  return events ? `${day}. ${balances}. Due: ${events}.` : `${day}. ${balances}.`
})

const todayDate = computed<IsoDate | null>(() => props.days[props.todayIndex] ?? null)

const summary = computed(() => {
  const first = props.days[0]
  const last = props.days[props.days.length - 1]
  const span = first && last ? `${formatDateShort(first)} to ${formatDateShort(last)}` : ''
  // Past/future is now a property of the line itself, and a dash pattern says
  // nothing to a screen reader. State the meaning first, the appearance second.
  const split = todayDate.value
    ? ` Recorded through ${formatDateShort(todayDate.value)}; everything after that is projected, drawn as a dashed line.`
    : ''
  if (!props.lowest) return `Balance forecast, ${span}.${split}`
  const side = props.status === 'short' ? 'below' : 'above'
  // The zero line is the only thing on screen saying the balance goes
  // negative, and a line is not readable. Said in words for the same reason
  // the low point is.
  const overdrawn = props.lowest.balance < 0 ? ' The balance goes negative in this window.' : ''
  return (
    `Balance forecast, ${span}.${split} Lowest projected balance ` +
    `${formatMoney(props.lowest.balance)} on ${formatDateShort(props.lowest.date)}, ` +
    `${side} your ${formatMoney(props.cushion)} safety cushion.${overdrawn}`
  )
})

function moveActive(delta: number): void {
  if (count.value === 0) return
  const from = activeIndex.value ?? props.todayIndex
  const next = Math.min(Math.max(from + delta, 0), count.value - 1)
  activeIndex.value = next
}

function onKeydown(event: KeyboardEvent): void {
  switch (event.key) {
    case 'ArrowLeft':
      moveActive(-1)
      break
    case 'ArrowRight':
      moveActive(1)
      break
    case 'Home':
      activeIndex.value = 0
      break
    case 'End':
      activeIndex.value = count.value - 1
      break
    case 'Enter':
    case ' ':
      if (activeDate.value) emit('selectDay', activeDate.value)
      break
    default:
      return
  }
  event.preventDefault()
}

function onFocus(): void {
  if (activeIndex.value === null) activeIndex.value = props.todayIndex
}
</script>

<template>
  <div class="relative">
    <svg
      :viewBox="`0 0 ${layout.width} ${layout.height}`"
      class="h-auto w-full rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      role="img"
      tabindex="0"
      :aria-label="summary"
      aria-describedby="burndown-help"
      @focus="onFocus"
      @blur="activeIndex = null"
      @keydown="onKeydown"
      @mouseleave="activeIndex = null"
    >
      <!-- Danger zone: everything below the cushion, the chart's one banded region. -->
      <rect
        :x="layout.left"
        :y="cushionY"
        :width="layout.width - layout.left - layout.right"
        :height="Math.max(plotBottom - cushionY, 0)"
        class="fill-destructive/10"
      />

      <line
        v-for="y in gridLines"
        :key="`grid-${y}`"
        :x1="layout.left"
        :x2="layout.width - layout.right"
        :y1="y"
        :y2="y"
        class="stroke-border"
        stroke-width="1"
      />

      <!-- Zero, solid where the cushion is dashed: the cushion is a number the
           user picked and can move, and this one is not. -->
      <line
        v-if="showZeroLine"
        :x1="layout.left"
        :x2="layout.width - layout.right"
        :y1="zeroY"
        :y2="zeroY"
        class="stroke-foreground/45"
        stroke-width="1.5"
      />

      <line
        :x1="layout.left"
        :x2="layout.width - layout.right"
        :y1="cushionY"
        :y2="cushionY"
        class="stroke-muted-foreground"
        stroke-width="1.5"
        stroke-dasharray="8 7"
      />

      <line
        :x1="todayX"
        :x2="todayX"
        :y1="layout.top"
        :y2="plotBottom"
        class="stroke-foreground/60"
        stroke-width="1.5"
        stroke-dasharray="3 6"
      />

      <line
        v-if="activeIndex !== null"
        :x1="activeX"
        :x2="activeX"
        :y1="layout.top"
        :y2="plotBottom"
        class="stroke-foreground/35"
        stroke-width="1.5"
      />

      <!-- Two paths per line rather than one dashed path through the whole
           series: history is always solid and the forecast always dashed
           (#63), and a round linecap on a single dashed path would swallow
           the gaps at the stroke widths this chart supports (Trap B) — butt
           caps on both segments keep the dashes readable at every density. -->
      <template v-for="line in drawnLines" :key="line.key">
        <path
          v-if="line.past"
          :d="line.past"
          fill="none"
          :stroke="line.stroke"
          :stroke-width="line.width"
          stroke-linecap="butt"
          stroke-linejoin="round"
          :data-series="line.key"
          data-segment="past"
        />
        <path
          v-if="line.future"
          :d="line.future"
          fill="none"
          :stroke="line.stroke"
          :stroke-width="line.width"
          :stroke-dasharray="line.dash"
          stroke-linecap="butt"
          stroke-linejoin="round"
          :data-series="line.key"
          data-segment="future"
        />
      </template>

      <circle
        v-for="marker in markers"
        :key="marker.key"
        :cx="marker.cx"
        :cy="marker.cy"
        :r="6 * props.density.markerSize"
        :stroke="marker.stroke"
        :fill="marker.filled ? marker.stroke : 'var(--background)'"
        stroke-width="2.5"
      />

      <circle
        v-if="lowestMarker"
        :cx="lowestMarker.cx"
        :cy="lowestMarker.cy"
        :r="9 * props.density.markerSize"
        class="fill-background stroke-destructive"
        stroke-width="3"
      />

      <!-- Per-day hover/tap targets. Deliberately transparent rather than
           `pointer-events` tricks so they still receive touch. -->
      <rect
        v-for="(date, index) in props.days"
        :key="`hit-${date}`"
        :x="bands[index]?.x"
        :y="layout.top"
        :width="bands[index]?.width"
        :height="plotBottom - layout.top"
        fill="transparent"
        :data-day="date"
        @mouseenter="activeIndex = index"
        @click="emit('selectDay', date)"
      />
    </svg>

    <!-- Annotations live in HTML rather than <text>: SVG text scales with the
         viewBox, which would render it at ~6px on a phone. -->
    <div class="pointer-events-none absolute inset-0">
      <span
        class="absolute -translate-x-1/2 -translate-y-full text-[11px] text-muted-foreground"
        :style="{
          left: `${percentOf(todayX, layout.width)}%`,
          top: `${percentOf(layout.top, layout.height)}%`,
        }"
        >Today</span
      >

      <!-- Right-aligned, because the cushion's own label is pinned to the left
           edge at a y that can be within a few pixels of this one. -->
      <span
        v-if="showZeroLine"
        class="absolute -translate-x-full -translate-y-1/2 pr-1 text-[11px] text-muted-foreground"
        :style="{
          left: `${percentOf(layout.width - layout.right, layout.width)}%`,
          top: `${percentOf(zeroY, layout.height)}%`,
        }"
        >$0</span
      >

      <div
        v-if="lowestMarker && props.lowest"
        class="absolute -translate-y-1/2 whitespace-nowrap"
        :class="cn(lowestFlipped ? '-ml-3 -translate-x-full text-right' : 'ml-3')"
        :style="{
          left: `${percentOf(lowestMarker.cx, layout.width)}%`,
          top: `${percentOf(lowestMarker.cy, layout.height)}%`,
        }"
      >
        <MoneyText
          :amount="props.lowest.balance"
          size="sm"
          class="block font-semibold text-destructive"
        />
        <span class="block text-[11px] text-muted-foreground">
          Lowest · {{ formatDateShort(props.lowest.date) }}
        </span>
      </div>

      <Popover>
        <PopoverTrigger
          class="pointer-events-auto absolute flex min-h-11 -translate-y-full items-end whitespace-nowrap rounded-md px-1 text-[11px] text-muted-foreground underline decoration-dotted underline-offset-4 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          :style="{
            left: `${percentOf(layout.left, layout.width)}%`,
            top: `${percentOf(cushionY, layout.height)}%`,
          }"
        >
          Safety cushion · {{ formatMoney(props.cushion) }}
        </PopoverTrigger>
        <PopoverContent side="top" align="start" class="max-w-[280px] text-sm">
          The lowest balance you're comfortable letting your account reach — dips below this are
          flagged as danger zone.
        </PopoverContent>
      </Popover>

      <!-- Card-styled tooltip; shown for hover and for keyboard focus alike. -->
      <div
        v-if="activeIndex !== null && tooltipRows.length > 0"
        class="absolute top-2 z-10 w-max max-w-[230px] rounded-lg border bg-card p-2.5 text-card-foreground shadow-md"
        :class="cn(tooltipFlipped ? '-translate-x-full -ml-2' : 'ml-2')"
        :style="{ left: `${percentOf(activeX, layout.width)}%` }"
      >
        <p class="text-xs font-medium">{{ activeLabel }}</p>
        <div
          v-for="row in tooltipRows"
          :key="row.key"
          class="mt-1.5 flex items-center gap-2 text-xs"
        >
          <span
            aria-hidden="true"
            class="inline-block size-2 shrink-0 rounded-full"
            :style="{ backgroundColor: row.stroke }"
          />
          <span class="min-w-0 flex-1 truncate text-muted-foreground">{{ row.name }}</span>
          <MoneyText :amount="row.balance" size="sm" />
        </div>
        <template v-if="tooltipOccurrences.length > 0">
          <Separator class="my-2" />
          <div
            v-for="occurrence in tooltipOccurrences"
            :key="occurrence.id"
            class="mt-1 flex items-center gap-2 text-xs"
          >
            <span class="min-w-0 flex-1 truncate">{{ occurrence.label }}</span>
            <MoneyText :amount="occurrence.amount" signed colored size="sm" />
          </div>
        </template>
      </div>
    </div>

    <!-- x-axis ticks, positioned against the same scale the SVG uses. -->
    <div class="relative mt-1 h-4" aria-hidden="true">
      <span
        v-for="tick in ticks"
        :key="`tick-${tick.index}`"
        class="absolute -translate-x-1/2 text-[11px] text-muted-foreground"
        :style="{ left: `${tick.leftPct}%` }"
      >
        {{ formatDateShort(tick.date) }}
      </span>
    </div>

    <p id="burndown-help" class="sr-only">
      Use the left and right arrow keys to move through the forecast day by day, and Enter to open
      that day's detail.
    </p>
    <p class="sr-only" aria-live="polite">{{ announcement }}</p>
  </div>
</template>
