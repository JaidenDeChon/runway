<script setup lang="ts">
/**
 * Candidate D — Chart.js 4, via `vue-chartjs`'s `<Line>` wrapper.
 *
 * Chart.js has no native reference-line or shaded-region primitive — hence
 * `chartjs-plugin-annotation`, registered like every other Chart.js piece
 * below (see the comment there for why a per-instance `:plugins` prop, which
 * would have kept it scoped to this component, doesn't work for this
 * particular plugin). That dependency is part of this candidate's real cost,
 * not incidental.
 *
 * Renders to `<canvas>`, same as the ECharts candidate: every colour is
 * resolved with `getComputedStyle` and re-resolved on a `colorMode.value`
 * watch, because a canvas fillStyle cannot read `var(--chart-2)` directly.
 */

import type {
  ActiveElement,
  ChartEvent,
  ChartOptions,
  ScriptableLineSegmentContext,
  TooltipItem,
} from 'chart.js'
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js'
import annotationPlugin from 'chartjs-plugin-annotation'
import { Line } from 'vue-chartjs'
import { valueRange } from '@/lib/burndown'
import { formatDateLong, formatDateShort, formatMoney } from '@/lib/format'
import type { IsoDate } from '~~/domain/dates'
import type { MinorUnits } from '~~/domain/money'

// chartjs-plugin-annotation has to go through the same global `register()`
// as everything else — passing it only via `<Line :plugins>` throws
// ("Cannot set properties of undefined (setting 'backgroundColor')"), because
// the plugin merges its options into `Chart.defaults.plugins.annotation`,
// which `register()` is what creates in the first place.
ChartJS.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Filler,
  annotationPlugin,
)

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

function resolveStroke(varExpr: string): string {
  return resolveVar(varExpr.replace('var(', '').replace(')', ''))
}

const range = computed(() =>
  valueRange([...props.series.map((entry) => entry.points), props.combined ?? []], props.cushion),
)

const lowestIndex = computed(() => (props.lowest ? props.days.indexOf(props.lowest.date) : -1))

/** index -> whether *any* selected account has an occurrence that day, and whether it was income. */
function eventAt(
  accountId: string,
  index: number,
): { onDay: true; filled: boolean } | { onDay: false } {
  const date = props.days[index]
  const onDay = date
    ? props.occurrencesByDay.get(date)?.filter((o) => o.accountId === accountId)
    : undefined
  if (!onDay || onDay.length === 0) return { onDay: false }
  return { onDay: true, filled: onDay.some((o) => o.amount > 0) }
}

function pointRadius(index: number, isLowest: boolean, accountId: string | null): number {
  if (isLowest && index === lowestIndex.value) return 9
  if (accountId && eventAt(accountId, index).onDay) return 4.5
  return 0
}

function onClick(_event: ChartEvent, elements: ActiveElement[]): void {
  const first = elements[0]
  if (!first) return
  const date = props.days[first.index]
  if (!date) return
  emit('selectDay', date)
}

const chartData = computed(() => {
  void themeTick.value

  const datasets = props.series.map((entry) => {
    const radii = entry.points.map((_, index) => pointRadius(index, false, entry.id))
    const backgrounds = entry.points.map((_, index) => {
      const event = eventAt(entry.id, index)
      return event.onDay && event.filled ? resolveStroke(entry.stroke) : resolveVar('--card')
    })
    return {
      label: entry.name,
      data: entry.points.map((point) => point.balance),
      borderColor: resolveStroke(entry.stroke),
      backgroundColor: resolveStroke(entry.stroke),
      borderWidth: 2.5,
      pointRadius: radii,
      // Chart.js applies a *fixed* hover radius/colour on top of a per-point
      // array unless told otherwise, so an invisible (radius 0) point pops up
      // as a stray default-black dot the instant the pointer gets near it —
      // mirroring the base arrays keeps a hovered point looking like itself.
      pointHoverRadius: radii,
      pointBackgroundColor: backgrounds,
      pointHoverBackgroundColor: backgrounds,
      pointBorderColor: resolveStroke(entry.stroke),
      pointHoverBorderColor: resolveStroke(entry.stroke),
      pointBorderWidth: 2,
      tension: 0,
      fill: false,
      // Chart.js's one native per-segment styling hook — a dash from the
      // segment ending at `todayIndex` onward, no second dataset required.
      segment: {
        borderDash: (ctx: ScriptableLineSegmentContext) =>
          ctx.p1DataIndex > props.todayIndex ? [6, 5] : undefined,
      },
    }
  })

  const combinedDataset = props.combined
    ? [
        (() => {
          const combined = props.combined as readonly { balance: MinorUnits }[]
          const radii = combined.map((_, index) => pointRadius(index, true, null))
          const backgrounds = combined.map((_, index) =>
            index === lowestIndex.value ? resolveVar('--background') : resolveVar('--chart-1'),
          )
          const borderWidths = combined.map((_, index) => (index === lowestIndex.value ? 3 : 0))
          return {
            label: 'Combined',
            data: combined.map((point) => point.balance),
            borderColor: resolveVar('--chart-1'),
            backgroundColor: resolveVar('--chart-1'),
            borderWidth: 3.5,
            pointRadius: radii,
            pointHoverRadius: radii,
            pointBackgroundColor: backgrounds,
            pointHoverBackgroundColor: backgrounds,
            pointBorderColor: resolveVar('--destructive'),
            pointHoverBorderColor: resolveVar('--destructive'),
            pointBorderWidth: borderWidths,
            tension: 0,
            fill: false,
            segment: {
              borderDash: (ctx: ScriptableLineSegmentContext) =>
                ctx.p1DataIndex > props.todayIndex ? [6, 5] : undefined,
            },
          }
        })(),
      ]
    : []

  return { labels: [...props.days], datasets: [...datasets, ...combinedDataset] }
})

const chartOptions = computed<ChartOptions<'line'>>(() => {
  void themeTick.value

  const mutedForeground = resolveVar('--muted-foreground')
  const border = resolveVar('--border')

  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    onClick,
    scales: {
      x: {
        type: 'category',
        grid: { display: false },
        border: { color: border },
        ticks: {
          color: mutedForeground,
          font: { size: 11 },
          maxTicksLimit: 6,
          callback(this: unknown, _value: unknown, index: number) {
            const day = props.days[index]
            return day ? formatDateShort(day) : ''
          },
        },
      },
      y: {
        display: false,
        min: range.value.min,
        max: range.value.max,
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        mode: 'index',
        intersect: false,
        backgroundColor: resolveVar('--card'),
        titleColor: resolveVar('--foreground'),
        bodyColor: resolveVar('--foreground'),
        borderColor: border,
        borderWidth: 1,
        padding: 8,
        callbacks: {
          title: (items: TooltipItem<'line'>[]) => {
            const day = props.days[items[0]?.dataIndex ?? 0]
            return day ? formatDateLong(day) : ''
          },
          label: (item: TooltipItem<'line'>) =>
            `${item.dataset.label}: ${formatMoney(item.parsed.y as MinorUnits)}`,
        },
      },
      annotation: {
        annotations: {
          cushionBand: {
            type: 'box',
            yMin: range.value.min,
            yMax: props.cushion,
            backgroundColor: resolveAlpha('--destructive', 12),
            borderWidth: 0,
          },
          cushionLine: {
            type: 'line',
            yMin: props.cushion,
            yMax: props.cushion,
            borderColor: mutedForeground,
            borderDash: [8, 7],
            borderWidth: 1.5,
            label: {
              display: true,
              content: `Safety cushion · ${formatMoney(props.cushion)}`,
              position: 'start',
              color: mutedForeground,
              backgroundColor: 'transparent',
              font: { size: 11, weight: 'normal' },
            },
          },
          today: {
            type: 'line',
            xMin: props.todayIndex,
            xMax: props.todayIndex,
            borderColor: resolveAlpha('--foreground', 60),
            borderDash: [3, 6],
            borderWidth: 1.5,
            label: {
              display: true,
              content: 'Today',
              position: 'end',
              color: mutedForeground,
              backgroundColor: 'transparent',
              font: { size: 11, weight: 'normal' },
            },
          },
          ...(props.lowest
            ? {
                lowestLabel: {
                  type: 'label' as const,
                  xValue: lowestIndex.value,
                  yValue: props.lowest.balance,
                  content: 'Lowest',
                  color: mutedForeground,
                  font: { size: 11 },
                  xAdjust: 22,
                  backgroundColor: 'transparent',
                },
              }
            : {}),
        },
      },
    },
    interaction: { mode: 'index', intersect: false },
  }
})
</script>

<template>
  <!-- Same canvas/getComputedStyle reasoning as the ECharts candidate applies to SSR. -->
  <ClientOnly>
    <div :style="{ height: `${props.height}px`, position: 'relative' }">
      <Line :data="chartData" :options="chartOptions" />
    </div>
    <template #fallback>
      <div class="w-full animate-pulse rounded-md bg-muted" :style="{ height: `${props.height}px` }" />
    </template>
  </ClientOnly>
</template>
