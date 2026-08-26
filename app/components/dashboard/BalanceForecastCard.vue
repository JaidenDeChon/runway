<script setup lang="ts">
/**
 * The chart card: header, horizon selector, stale-balance alert, chart, legend.
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
import StaleBalancesAlert from '@/components/dashboard/StaleBalancesAlert.vue'
import ResponsiveEditor from '@/components/ResponsiveEditor.vue'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { ChartDensity, ChartSeries, LegendEntry } from '@/lib/burndown'
import { SEGMENTED_SEGMENT, SEGMENTED_TRACK } from '@/lib/segmented-control'
import { cn } from '@/lib/utils'
import type { BalanceReadings } from '~~/domain/accounts'
import type { IsoDate } from '~~/domain/dates'
import type { MinorUnits } from '~~/domain/money'
import type { DayPoint, LowestPoint, Occurrence, RunwayStatus } from '~~/domain/projection'
import type { Account } from '~~/domain/types'

const props = defineProps<{
  days: readonly IsoDate[]
  series: readonly ChartSeries[]
  combined: readonly DayPoint[] | null
  occurrencesByDay: ReadonlyMap<IsoDate, readonly Occurrence[]>
  legend: readonly LegendEntry[]
  /**
   * Whether the accounts' balances describe one moment — `balanceReadings`'s
   * answer, computed in the domain and never here. It gates the alert above the
   * chart; it does not change a single figure below it.
   */
  readings: BalanceReadings
  accountsById: Map<string, Account>
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
  updateBalances: []
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
          Departure from spec.md line 292, requested: the horizon group was the
          one segmented control specced to fill with `--primary` instead of
          lifting to `--card`. It now uses the same treatment as every other
          segmented control in the app.
        -->
        <ToggleGroup
          :model-value="String(props.horizonDays)"
          type="single"
          aria-label="Forecast horizon"
          :class="SEGMENTED_TRACK"
          @update:model-value="setHorizon"
        >
          <ToggleGroupItem
            v-for="horizon in HORIZONS"
            :key="horizon"
            :value="String(horizon)"
            :class="cn(SEGMENTED_SEGMENT, 'h-11 px-3.5 lg:h-9')"
          >
            {{ horizon }}d
          </ToggleGroupItem>
        </ToggleGroup>

        <Button
          variant="outline"
          size="icon"
          class="size-11 lg:size-9"
          aria-label="Chart display settings"
          aria-haspopup="dialog"
          @click="emit('update:densityOpen', true)"
        >
          <Settings2 aria-hidden="true" class="size-4" />
        </Button>
      </div>
    </div>

    <!--
      Directly above the chart, and inside the card, because it is a warning
      about the very lines drawn below it: everything under this alert is
      derived from readings that do not describe one moment.
    -->
    <StaleBalancesAlert
      v-if="!props.readings.isConsistent"
      class="mt-3.5 w-auto px-4 lg:px-5"
      :readings="props.readings"
      :accounts-by-id="props.accountsById"
      @update="emit('updateBalances')"
    />

    <!--
      An overlay rather than an inline block: the panel pushed the chart down
      the moment it opened, so the thing being adjusted moved out from under the
      controls adjusting it. `ResponsiveEditor` is the app's one answer for this
      — a centred Dialog on desktop, a bottom Sheet on mobile — and the sliders
      apply live, so it needs no save step and no footer.
    -->
    <ResponsiveEditor
      :open="props.densityOpen"
      title="Chart display"
      description="Changes apply to the chart as you make them."
      @update:open="(value) => emit('update:densityOpen', value)"
    >
      <ChartDensityPanel
        :density="props.density"
        @update:density="(value) => emit('update:density', value)"
      />
    </ResponsiveEditor>

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
