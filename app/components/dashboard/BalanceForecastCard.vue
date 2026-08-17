<script setup lang="ts">
/**
 * The chart card: header, horizon selector, density panel, chart, legend.
 *
 * It owns no data — the series, the verdict and the occurrences all arrive
 * already computed — and no projection state. What it does own is the three
 * presentation controls the design puts in this card's chrome, because none of
 * them means anything anywhere else on the screen.
 */
import { Settings2 } from '@lucide/vue'
import AccountLegendRow from '@/components/dashboard/AccountLegendRow.vue'
import BurndownChart from '@/components/dashboard/BurndownChart.vue'
import ChartDensityPanel from '@/components/dashboard/ChartDensityPanel.vue'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { ChartDensity, ChartSeries, LegendEntry } from '@/lib/burndown'
import { cn } from '@/lib/utils'
import type { IsoDate } from '~~/domain/dates'
import type { MinorUnits } from '~~/domain/money'
import type { DayPoint, LowestPoint, Occurrence, RunwayStatus } from '~~/domain/projection'

const props = defineProps<{
  days: readonly IsoDate[]
  series: readonly ChartSeries[]
  combined: readonly DayPoint[] | null
  occurrencesByDay: ReadonlyMap<IsoDate, readonly Occurrence[]>
  legend: readonly LegendEntry[]
  cushion: MinorUnits
  todayIndex: number
  lowest: LowestPoint | null
  status: RunwayStatus
  horizonDays: number
  density: ChartDensity
  densityOpen: boolean
  loading: boolean
  whatIf: boolean
  desktop: boolean
}>()

const emit = defineEmits<{
  'update:horizonDays': [value: number]
  'update:density': [value: ChartDensity]
  'update:densityOpen': [value: boolean]
  'update:accountChecked': [accountId: string, checked: boolean]
  selectDay: [date: IsoDate]
}>()

const HORIZONS = [30, 60, 90] as const

function setHorizon(value: unknown): void {
  const parsed = Number(value)
  if (HORIZONS.some((horizon) => horizon === parsed)) emit('update:horizonDays', parsed)
}
</script>

<template>
  <Card
    :class="
      cn('gap-0 py-4 lg:py-5', props.whatIf && 'border border-dashed border-chart-5 ring-chart-5/40')
    "
  >
    <p
      v-if="props.whatIf"
      class="mx-4 mb-3 flex items-center gap-2 rounded-md border border-dashed border-chart-5 bg-chart-5/10 px-3 py-2 text-sm font-medium text-chart-5 lg:mx-5"
    >
      <span aria-hidden="true">◑</span>
      Previewing what-if — not saved
    </p>

    <div class="flex flex-wrap items-start justify-between gap-3 px-4 lg:px-5">
      <div class="min-w-0">
        <h2 class="text-base font-medium">Balance forecast</h2>
        <p class="text-sm text-muted-foreground">
          14 days back · {{ props.horizonDays }} days ahead
        </p>
      </div>

      <div class="flex items-center gap-2">
        <!--
          `rounded-md!` on the items is deliberate. ToggleGroupItem ships
          `group-data-[spacing=0]/toggle-group:rounded-none`, whose descendant
          selector outranks a plain `rounded-md` on specificity, so every segment
          squares off against this rounded track. The registry's compensating
          `first:rounded-l-*`/`last:rounded-r-*` rules are gated behind
          `group-data-horizontal/toggle-group` and never match, because no
          `orientation` prop is passed. `md` is the correct inner radius here:
          `lg` (10px) minus the 2px `p-0.5` track padding is `md` (8px).

          `shadow-sm!` needs the bang for the same reason — the registry's
          `group-data-[spacing=0]/toggle-group:shadow-none` would otherwise win.
          The raised `--background` pill matches the mode tabs on Will I Make It.
          `--input` carries the active fill in dark, where `--background` would
          sit darker than its own track and read as recessed rather than raised.
        -->
        <ToggleGroup
          :model-value="String(props.horizonDays)"
          type="single"
          aria-label="Forecast horizon"
          class="rounded-lg bg-muted p-0.5"
          @update:model-value="setHorizon"
        >
          <ToggleGroupItem
            v-for="horizon in HORIZONS"
            :key="horizon"
            :value="String(horizon)"
            class="h-11 rounded-md! border border-transparent px-3.5 data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm! lg:h-9 dark:data-[state=on]:border-input dark:data-[state=on]:bg-input/30"
          >
            {{ horizon }}d
          </ToggleGroupItem>
        </ToggleGroup>

        <Button
          variant="outline"
          size="icon"
          class="size-11 lg:size-9"
          aria-label="Chart density"
          aria-controls="chart-density-panel"
          :aria-expanded="props.densityOpen"
          @click="emit('update:densityOpen', !props.densityOpen)"
        >
          <Settings2 aria-hidden="true" class="size-4" />
        </Button>
      </div>
    </div>

    <div v-if="props.densityOpen" id="chart-density-panel" class="mt-3 px-4 lg:px-5">
      <ChartDensityPanel
        :density="props.density"
        @update:density="(value) => emit('update:density', value)"
      />
    </div>

    <div class="mt-3 px-4 lg:px-5">
      <!-- The skeleton stands in at the chart's exact aspect so the card does
           not resize when the real chart arrives. -->
      <Skeleton
        v-if="props.loading"
        :class="cn('w-full rounded-lg', props.desktop ? 'aspect-[860/460]' : 'aspect-[720/400]')"
      />
      <BurndownChart
        v-else
        :days="props.days"
        :series="props.series"
        :combined="props.combined"
        :occurrences-by-day="props.occurrencesByDay"
        :cushion="props.cushion"
        :today-index="props.todayIndex"
        :lowest="props.lowest"
        :status="props.status"
        :density="props.density"
        :horizon-days="props.horizonDays"
        :desktop="props.desktop"
        @select-day="(date) => emit('selectDay', date)"
      />
    </div>

    <Separator class="mt-4" />

    <div class="flex flex-wrap items-center gap-x-5 px-4 pt-2 lg:px-5">
      <AccountLegendRow
        v-for="entry in props.legend"
        :key="entry.accountId"
        :account-id="entry.accountId"
        :name="entry.name"
        :color="entry.color"
        :ending-balance="entry.endingBalance"
        :checked="entry.checked"
        :disabled="entry.disabled"
        @update:checked="(value) => emit('update:accountChecked', entry.accountId, value)"
      />

      <p v-if="props.combined" class="flex min-h-11 items-center gap-2 text-sm">
        <span aria-hidden="true" class="inline-block h-0.5 w-4 rounded-full bg-chart-1" />
        Combined
      </p>
    </div>
  </Card>
</template>
