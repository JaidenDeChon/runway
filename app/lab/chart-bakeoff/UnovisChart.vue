<script setup lang="ts">
/**
 * Candidate B — the designated baseline. `@unovis/vue` drawing inside the
 * shadcn-vue `chart` chassis (`ChartContainer` / `ChartStyle` /
 * `ChartTooltipContent`, installed via `bunx shadcn-vue@latest add chart`).
 *
 * The chassis provides layout and theming plumbing; it draws nothing itself
 * (see `docs/spikes/chart-library-bakeoff.md` — F1). Every mark on screen here
 * is an `@unovis/vue` component: `VisLine`, `VisScatter`, `VisPlotline`,
 * `VisPlotband`, `VisAxis`, `VisCrosshair`.
 *
 * Colour flows through `ChartStyle`, which is the chassis's actual job: a
 * `ChartConfig` maps each series id to a `var(--chart-N)` token, and
 * `ChartStyle` emits a scoped `--color-<key>` custom property from it. Every
 * mark below reads `var(--color-<key>)` rather than the token directly, so
 * this candidate genuinely exercises the mechanism rather than routing around
 * it.
 */
import { Scatter } from '@unovis/ts'
import {
  VisAxis,
  VisCrosshair,
  VisLine,
  VisPlotband,
  VisPlotline,
  VisScatter,
  VisXYContainer,
} from '@unovis/vue'
import type { ChartConfig } from '@/components/ui/chart'
import { ChartContainer, ChartTooltipContent, componentToString } from '@/components/ui/chart'
import { valueRange } from '@/lib/burndown'
import { formatDateLong, formatDateShort, formatMoney } from '@/lib/format'
import type { IsoDate } from '~~/domain/dates'
import type { MinorUnits } from '~~/domain/money'

const props = defineProps<{
  days: readonly IsoDate[]
  series: readonly {
    id: string
    name: string
    /** A `var(--chart-N)` reference, already resolved from the account's own colour — see `fixture.ts`. */
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

interface Row {
  index: number
  date: IsoDate
  [seriesId: string]: number | string
}

const rows = computed<Row[]>(() =>
  props.days.map((date, index) => {
    const row: Row = { index, date }
    for (const entry of props.series) row[entry.id] = entry.points[index]?.balance ?? 0
    if (props.combined) row.combined = props.combined[index]?.balance ?? 0
    return row
  }),
)

/**
 * `ChartConfig` is the chassis's own type: each key gets a label and a token
 * colour. The colour comes from the account's own `stroke` (already resolved
 * in `fixture.ts` from `account.color`) — never reassigned by position, so
 * this candidate colours each account exactly like the incumbent does.
 */
const chartConfig = computed<ChartConfig>(() => {
  const entries: ChartConfig = {}
  for (const entry of props.series) entries[entry.id] = { label: entry.name, color: entry.stroke }
  if (props.combined) entries.combined = { label: 'Combined', color: 'var(--chart-1)' }
  return entries
})

/** Same padded range the incumbent uses — pure geometry, not a new financial figure. */
const range = computed(() =>
  valueRange([...props.series.map((entry) => entry.points), props.combined ?? []], props.cushion),
)

const xDomain = computed<[number, number]>(() => [0, Math.max(props.days.length - 1, 0)])

/**
 * Split at `todayIndex` so a solid "past" `VisLine` and a dashed "future" one
 * share one series — two `VisLine`s over two slices of the same rows, which
 * is the one place in this file a per-component `data` override actually
 * behaves as documented. `computed()` rather than a function called from the
 * template mainly for the usual reason (no re-slicing on every unrelated
 * re-render); see `lowestY` below for the component this *doesn't* work for.
 */
const pastRows = computed(() => rows.value.slice(0, props.todayIndex + 1))
const futureRows = computed(() => rows.value.slice(props.todayIndex))

const lowestIndex = computed(() => (props.lowest ? props.days.indexOf(props.lowest.date) : -1))

/**
 * `@unovis/vue`'s `VisScatter` does not honour a per-component `data`
 * override the way `VisLine` does — confirmed by isolating a single scatter
 * bound to a genuinely one-row computed and finding 45 rendered points
 * (`rows.length`, the *container's* data) instead of 1, with the computed's
 * reactive value verified correct via a temporary `watchEffect`. Every
 * `VisScatter` below is therefore bound to the same `rows` the container
 * uses, and hides the days it doesn't want by having its own accessor return
 * `undefined` for them — `undefined`/`NaN` y-values are the one thing that
 * reliably drops a point, confirmed by the same isolation test. This is a
 * real, load-bearing finding about the baseline, not a style choice: any
 * integration needing a scatter subset (event markers, a single highlighted
 * point) hits this.
 */
function lowestY(d: Row): number | undefined {
  if (d.index !== lowestIndex.value) return undefined
  return props.combined ? (d.combined as number) : (d[props.series[0]?.id ?? ''] as number)
}

interface SeriesMark {
  readonly balance: number
  readonly filled: boolean
}

/** index -> mark, per series id (plus 'combined') — an occurrence's day and whether it was income. */
const eventMarksBySeries = computed<Record<string, Map<number, SeriesMark>>>(() => {
  const bySeries: Record<string, Map<number, SeriesMark>> = {}
  for (const entry of props.series) bySeries[entry.id] = new Map()
  if (props.combined) bySeries.combined = new Map()
  for (const [index, date] of props.days.entries()) {
    const onDay = props.occurrencesByDay.get(date)
    if (!onDay || onDay.length === 0) continue
    const row = rows.value[index]
    if (!row) continue
    for (const entry of props.series) {
      const forAccount = onDay.filter((occurrence) => occurrence.accountId === entry.id)
      if (forAccount.length === 0) continue
      bySeries[entry.id]?.set(index, {
        balance: row[entry.id] as number,
        filled: forAccount.some((occurrence) => occurrence.amount > 0),
      })
    }
    if (props.combined) {
      bySeries.combined?.set(index, {
        balance: row.combined as number,
        filled: onDay.some((occurrence) => occurrence.amount > 0),
      })
    }
  }
  return bySeries
})

const showZeroLine = computed(
  () => range.value.min < 0 && range.value.max > 0 && props.cushion !== 0,
)

/** One accessor per drawn line, so the crosshair can circle every series, not just one. */
const crosshairYAccessors = computed(() => {
  const accessors = props.series.map((entry) => (d: Row) => d[entry.id] as number)
  if (props.combined) accessors.push((d: Row) => d.combined as number)
  return accessors
})

/**
 * `componentToString` + `ChartTooltipContent` is the chassis's own documented
 * pattern for a crosshair tooltip. Wired exactly as shown — and the crosshair
 * itself tracks the pointer correctly (its indicator circles land on the
 * right series at the right x) — but no tooltip content ever appears on
 * screen; `document.body`'s and the chart's own subtree never gain a
 * populated tooltip node on hover, observed directly in the DOM. Root cause
 * not confirmed within this spike's budget, but `chart/utils.ts`'s
 * `componentToString` is also the source of the SSR hydration mismatch this
 * candidate hits on first paint (it calls Reka UI's `useId()` only when
 * `isClient`, desyncing the id counter between server and client renders) —
 * the same function misbehaving twice is more likely one bug than two.
 * Recorded as a genuine, unresolved defect in the baseline's own chassis
 * utility, not a documentation gap in this file.
 */
const tooltipTemplate = componentToString(chartConfig.value, ChartTooltipContent, {
  labelFormatter: (x: number | Date) => {
    const day = props.days[Math.round(Number(x))]
    return day ? formatDateLong(day) : ''
  },
})

const lastClicked = ref<IsoDate | null>(null)

function onPointClick(datum: Row): void {
  lastClicked.value = datum.date
  emit('selectDay', datum.date)
}

const summary = computed(() => {
  const first = props.days[0]
  const last = props.days[props.days.length - 1]
  if (!props.lowest || !first || !last) return 'Balance forecast.'
  return (
    `Balance forecast, ${formatDateShort(first)} to ${formatDateShort(last)}. ` +
    `Lowest projected balance ${formatMoney(props.lowest.balance)} on ${formatDateShort(props.lowest.date)}.`
  )
})
</script>

<template>
  <ChartContainer :config="chartConfig" class="aspect-auto">
    <VisXYContainer
      :data="rows"
      :height="props.height"
      :x="(d: Row) => d.index"
      :x-domain="xDomain"
      :y-domain="[range.min, range.max]"
      :aria-label="summary"
      :padding="{ top: 12, bottom: 4, left: 4, right: 45 }"
    >
      <VisPlotband axis="y" :from="range.min" :to="props.cushion" color="color-mix(in oklch, var(--destructive) 12%, transparent)" />

      <!--
        Every labelColor below is explicit. Unovis's own default
        (`--vis-plotline-label-color`) only switches for dark mode under
        `html.dark-theme` / `html[data-theme=dark]` selectors it ships
        itself — this app's actual dark-mode class is a bare `.dark`
        (`@nuxtjs/color-mode`, `classSuffix: ''`), which none of those match.
        Left on its default, every label stays near-black and goes almost
        illegible against the dark surface — observed, not assumed; see the
        write-up. label-offset-x is widened past the default 14px because the
        cushion label otherwise gets clipped by the frame's left edge.
      -->
      <VisPlotline
        axis="y"
        :value="props.cushion"
        color="var(--muted-foreground)"
        :line-style="[8, 7]"
        :label-text="`Safety cushion · ${formatMoney(props.cushion)}`"
        label-position="top-left"
        :label-offset-x="4"
        label-color="var(--muted-foreground)"
      />

      <VisPlotline
        v-if="showZeroLine"
        axis="y"
        :value="0"
        color="color-mix(in oklch, var(--foreground) 45%, transparent)"
        label-text="$0"
        label-position="top-right"
        label-color="var(--muted-foreground)"
      />

      <VisPlotline
        axis="x"
        :value="props.todayIndex"
        color="color-mix(in oklch, var(--foreground) 60%, transparent)"
        :line-style="[3, 6]"
        label-text="Today"
        label-position="top-right"
        label-color="var(--muted-foreground)"
      />

      <template v-for="entry in props.series" :key="entry.id">
        <VisLine
          :data="pastRows"
          :x="(d: Row) => d.index"
          :y="(d: Row) => d[entry.id] as number"
          :color="() => `var(--color-${entry.id})`"
          :line-width="2.5"
        />
        <VisLine
          :data="futureRows"
          :x="(d: Row) => d.index"
          :y="(d: Row) => d[entry.id] as number"
          :color="() => `var(--color-${entry.id})`"
          :line-width="2.5"
          :line-dash-array="() => [6, 5]"
        />
      </template>

      <template v-if="props.combined">
        <VisLine
          key="combined-past"
          :data="pastRows"
          :x="(d: Row) => d.index"
          :y="(d: Row) => d.combined as number"
          color="var(--color-combined)"
          :line-width="3.5"
        />
        <VisLine
          key="combined-future"
          :data="futureRows"
          :x="(d: Row) => d.index"
          :y="(d: Row) => d.combined as number"
          color="var(--color-combined)"
          :line-width="3.5"
          :line-dash-array="() => [6, 5]"
        />
      </template>

      <VisScatter
        key="lowest"
        :data="rows"
        :x="(d: Row) => d.index"
        :y="lowestY"
        color="var(--background)"
        stroke-color="var(--destructive)"
        :stroke-width="3"
        :size="16"
        label="Lowest"
        label-position="right"
        label-color="var(--muted-foreground)"
      />

      <template v-for="entry in props.series" :key="`events-${entry.id}`">
        <VisScatter
          :data="rows"
          :x="(d: Row) => d.index"
          :y="(d: Row) => eventMarksBySeries[entry.id]?.get(d.index)?.balance"
          :color="(d: Row) => (eventMarksBySeries[entry.id]?.get(d.index)?.filled ? `var(--color-${entry.id})` : 'var(--background)')"
          :stroke-color="`var(--color-${entry.id})`"
          :stroke-width="2"
          :size="9"
        />
      </template>
      <VisScatter
        v-if="props.combined"
        key="events-combined"
        :data="rows"
        :x="(d: Row) => d.index"
        :y="(d: Row) => eventMarksBySeries.combined?.get(d.index)?.balance"
        :color="(d: Row) => (eventMarksBySeries.combined?.get(d.index)?.filled ? 'var(--color-combined)' : 'var(--background)')"
        stroke-color="var(--color-combined)"
        :stroke-width="2"
        :size="9"
      />

      <!--
        Capability 7 asks for a click ON a data point, so this sits directly
        on the combined (or only) line's actual value rather than trying to
        replicate the incumbent's full-height day-band with a marker
        primitive that doesn't have one — a transparent, generously sized
        circle on every real point, clickable without needing to land on a
        rendered pixel exactly.
      -->
      <VisScatter
        key="hit-area"
        :data="rows"
        :x="(d: Row) => d.index"
        :y="(d: Row) => (props.combined ? (d.combined as number) : (d[props.series[0]?.id ?? ''] as number))"
        :size="22"
        color="transparent"
        cursor="pointer"
        :events="{ [Scatter.selectors.point]: { click: onPointClick } }"
      />

      <VisAxis
        type="x"
        :tick-format="(tick: number | Date) => { const day = props.days[Math.round(Number(tick))]; return day ? formatDateShort(day) : '' }"
        :num-ticks="6"
        :grid-line="false"
        :domain-line="false"
      />

      <!-- `:x` has to be repeated here — VisCrosshair does not inherit the
           container's x accessor, and silently produces NaN coordinates
           (and a console error on every mouse move) without it. -->
      <VisCrosshair :x="(d: Row) => d.index" :y="crosshairYAccessors" :template="tooltipTemplate" />
    </VisXYContainer>
  </ChartContainer>

  <p class="mt-1 text-xs text-muted-foreground">
    Last clicked (capability 7): {{ lastClicked ? formatDateLong(lastClicked) : 'nothing clicked yet' }}
  </p>
</template>
