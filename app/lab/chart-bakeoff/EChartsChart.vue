<script setup lang="ts">
/**
 * Candidate C — Apache ECharts, via `vue-echarts` directly rather than
 * `nuxt-echarts`.
 *
 * Deviation from the plan's dependency table, recorded here per its own
 * stated fallback: `nuxt-echarts` is a Nuxt *module*, and modules run at
 * build/server-init time regardless of which page ends up using them — the
 * `RUNWAY_LAB=0` production build would carry it even though no production
 * route imports it. `vue-echarts` is a plain component; importing it only
 * from this file (itself only reachable from a `RUNWAY_LAB`-gated page) is
 * what actually keeps a production build clean, which is the property that
 * matters here, not which package is on the label.
 *
 * ECharts renders to `<canvas>` by default, and a canvas fillStyle cannot
 * resolve `var(--chart-2)` the way an SVG attribute can — there is no element
 * for the custom property to inherit through. Every colour below is resolved
 * with `getComputedStyle` and re-resolved whenever the color-mode composable
 * reports a change, per the plan's risk table for exactly this candidate.
 */

import { LineChart, ScatterChart } from 'echarts/charts'
import {
  GridComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import VChart from 'vue-echarts'
import { valueRange } from '@/lib/burndown'
import { formatDateLong, formatDateShort, formatMoney } from '@/lib/format'
import type { IsoDate } from '~~/domain/dates'
import type { MinorUnits } from '~~/domain/money'

echarts.use([
  LineChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  MarkLineComponent,
  MarkAreaComponent,
  MarkPointComponent,
  CanvasRenderer,
])

const props = defineProps<{
  days: readonly IsoDate[]
  series: readonly {
    id: string
    name: string
    stroke: string
    points: readonly { date: IsoDate; balance: MinorUnits }[]
  }[]
  combined: readonly { date: IsoDate; balance: MinorUnits }[] | null
  occurrencesByDay: ReadonlyMap<
    IsoDate,
    readonly { id: string; date: IsoDate; accountId: string; amount: MinorUnits }[]
  >
  cushion: MinorUnits
  todayIndex: number
  lowest: { date: IsoDate; balance: MinorUnits } | null
  height: number
}>()

const emit = defineEmits<{ selectDay: [date: IsoDate] }>()

const colorMode = useColorMode()

/** Bumped whenever the resolved theme changes, so `option` recomputes with freshly-resolved colours. */
const themeTick = ref(0)
watch(
  () => colorMode.value,
  () => {
    themeTick.value++
  },
)

function resolveVar(name: string): string {
  if (import.meta.server) return '#888'
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'
}

function resolveAlpha(name: string, percent: number): string {
  return `color-mix(in oklch, ${resolveVar(name)} ${percent}%, transparent)`
}

/** `'var(--chart-2)'` -> resolved colour. `fixture.ts`'s `ChartSeries.stroke` is always this shape. */
function resolveStroke(varExpr: string): string {
  const name = varExpr.replace('var(', '').replace(')', '')
  return resolveVar(name)
}

const range = computed(() =>
  valueRange([...props.series.map((entry) => entry.points), props.combined ?? []], props.cushion),
)

const lastClicked = ref<IsoDate | null>(null)

function onClick(params: { name?: string }): void {
  const date = params.name
  if (!date) return
  lastClicked.value = date as IsoDate
  emit('selectDay', date as IsoDate)
}

/**
 * One series split at `todayIndex`, `null` outside its own half so the two
 * halves draw as separate solid/dashed segments on what reads as one line —
 * ECharts has no native "dash from here on" per-segment primitive either, so
 * this is the same two-series technique every other non-incumbent candidate
 * needed.
 */
function splitSeries(points: readonly { balance: MinorUnits }[], past: boolean): (number | null)[] {
  return points.map((point, index) => {
    const inHalf = past ? index <= props.todayIndex : index >= props.todayIndex
    return inHalf ? point.balance : null
  })
}

const option = computed(() => {
  void themeTick.value // establishes the dependency; colours below are re-resolved each time it changes

  const mutedForeground = resolveVar('--muted-foreground')
  const foreground = resolveVar('--foreground')
  const border = resolveVar('--border')

  const lineSeries = props.series.flatMap((entry) => {
    const values = entry.points.map((point) => point.balance)
    return [
      {
        name: entry.name,
        type: 'line' as const,
        data: splitSeries(entry.points, true),
        color: resolveStroke(entry.stroke),
        lineStyle: { width: 2.5 },
        symbol: 'none',
        z: 2,
      },
      {
        name: entry.name,
        type: 'line' as const,
        data: splitSeries(entry.points, false),
        color: resolveStroke(entry.stroke),
        lineStyle: { width: 2.5, type: 'dashed' as const },
        symbol: 'none',
        z: 2,
        // NOT `tooltip: { show: false }` — that doesn't just suppress a
        // duplicate legend row (the intent), it removes this series from the
        // axis-triggered tooltip's `params` entirely. Since past/future are
        // mutually exclusive per index (see `splitSeries`), the only real
        // duplicate is the single index exactly at `todayIndex`, which the
        // formatter below dedupes by name instead.
        legendHoverLink: false,
      },
      {
        // Event markers: a point only on days this account has an occurrence.
        name: `${entry.name} events`,
        type: 'scatter' as const,
        data: props.days.map((date, index) => {
          const onDay = props.occurrencesByDay
            .get(date)
            ?.filter((occurrence) => occurrence.accountId === entry.id)
          if (!onDay || onDay.length === 0) return null
          return {
            value: values[index] ?? null,
            itemStyle: {
              color: onDay.some((o) => o.amount > 0) ? undefined : resolveVar('--card'),
            },
          }
        }),
        symbolSize: 9,
        itemStyle: {
          color: resolveStroke(entry.stroke),
          borderColor: resolveStroke(entry.stroke),
          borderWidth: 2,
        },
        tooltip: { show: false },
        z: 3,
      },
    ]
  })

  const combinedSeries = props.combined
    ? [
        {
          name: 'Combined',
          type: 'line' as const,
          data: splitSeries(props.combined, true),
          color: resolveVar('--chart-1'),
          lineStyle: { width: 3.5 },
          symbol: 'none',
          z: 2,
        },
        {
          name: 'Combined',
          type: 'line' as const,
          data: splitSeries(props.combined, false),
          color: resolveVar('--chart-1'),
          lineStyle: { width: 3.5, type: 'dashed' as const },
          symbol: 'none',
          legendHoverLink: false,
          z: 2,
        },
      ]
    : []

  const lowestSeries = props.lowest
    ? [
        {
          name: 'Lowest',
          type: 'scatter' as const,
          data: [{ name: 'Lowest', value: [props.lowest.date, props.lowest.balance] }],
          symbolSize: 16,
          itemStyle: {
            color: resolveVar('--background'),
            borderColor: resolveVar('--destructive'),
            borderWidth: 3,
          },
          label: {
            show: true,
            formatter: 'Lowest',
            position: 'right' as const,
            color: mutedForeground,
            fontSize: 11,
          },
          z: 4,
        },
      ]
    : []

  return {
    animation: false,
    grid: { top: 28, left: 8, right: 56, bottom: 28 },
    xAxis: {
      type: 'category' as const,
      data: props.days,
      boundaryGap: false,
      axisLine: { lineStyle: { color: border } },
      axisTick: { show: false },
      axisLabel: {
        color: mutedForeground,
        fontSize: 11,
        formatter: (value: string) => formatDateShort(value as IsoDate),
        interval: Math.max(Math.floor(props.days.length / 6), 1),
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value' as const,
      show: false,
      min: range.value.min,
      max: range.value.max,
      splitLine: { lineStyle: { color: border, type: 'dashed' as const } },
    },
    tooltip: {
      trigger: 'axis' as const,
      axisPointer: { type: 'cross' as const, label: { show: false } },
      backgroundColor: resolveVar('--card'),
      borderColor: border,
      textStyle: { color: foreground, fontSize: 12 },
      formatter: (params: unknown) => {
        const seen = new Set<string>()
        const rows = (
          params as { seriesName: string; value: number; color: string; seriesType: string }[]
        ).filter((row) => {
          if (row.seriesType !== 'line' || row.seriesName.endsWith('events') || row.value == null)
            return false
          // The one real duplicate: exactly at todayIndex, past and future
          // both include the boundary point (see splitSeries).
          if (seen.has(row.seriesName)) return false
          seen.add(row.seriesName)
          return true
        })
        if (rows.length === 0) return ''
        const dateLabel = formatDateLong(
          props.days[(params as { dataIndex: number }[])[0]?.dataIndex ?? 0] ??
            props.days[0] ??
            ('' as IsoDate),
        )
        const lines = rows
          .map(
            (row) =>
              `<div style="display:flex;align-items:center;gap:6px;margin-top:2px;">
                 <span style="display:inline-block;width:8px;height:8px;border-radius:9999px;background:${row.color}"></span>
                 <span style="flex:1">${row.seriesName}</span>
                 <span>${formatMoney(row.value)}</span>
               </div>`,
          )
          .join('')
        return `<div style="font-weight:500;margin-bottom:2px;">${dateLabel}</div>${lines}`
      },
    },
    series: [
      ...lineSeries,
      ...combinedSeries,
      ...lowestSeries,
      {
        name: 'Today marker',
        type: 'line' as const,
        data: [],
        markLine: {
          symbol: 'none' as const,
          silent: true,
          label: {
            show: true,
            formatter: 'Today',
            position: 'insideEndTop' as const,
            color: mutedForeground,
            fontSize: 11,
          },
          lineStyle: {
            color: resolveAlpha('--foreground', 60),
            type: [3, 6] as unknown as string,
            width: 1.5,
          },
          data: [{ xAxis: props.todayIndex }],
        },
      },
      {
        name: 'Cushion',
        type: 'line' as const,
        data: [],
        markArea: {
          silent: true,
          itemStyle: { color: resolveAlpha('--destructive', 12) },
          data: [[{ yAxis: range.value.min }, { yAxis: props.cushion }]],
        },
        markLine: {
          symbol: 'none' as const,
          silent: true,
          label: {
            show: true,
            formatter: `Safety cushion · ${formatMoney(props.cushion)}`,
            position: 'insideStartTop' as const,
            color: mutedForeground,
            fontSize: 11,
          },
          lineStyle: { color: mutedForeground, type: 'dashed' as const, width: 1.5 },
          data: [{ yAxis: props.cushion }],
        },
      },
      // Several of the series above share a `name` (each account appears as a
      // past segment, a future segment and an events layer). Without this,
      // hovering triggers ECharts' default cross-series emphasis/blur and the
      // segments *not* under the cursor visibly fade — observed as the past
      // half of every line disappearing on hover, which reads as data loss
      // rather than a hover state.
    ].map((entry) => ({ ...entry, emphasis: { disabled: true } })),
  }
})
</script>

<template>
  <!--
    ECharts instantiates a real canvas and reads computed styles, neither of
    which exist during SSR — ClientOnly is vue-echarts' own documented
    integration point for a universally-rendered app, not a workaround.
  -->
  <ClientOnly>
    <VChart
      class="w-full"
      :style="{ height: `${props.height}px` }"
      :option="option"
      autoresize
      @click="onClick"
    />
    <template #fallback>
      <div class="w-full animate-pulse rounded-md bg-muted" :style="{ height: `${props.height}px` }" />
    </template>
  </ClientOnly>
</template>
