<script setup lang="ts">
/**
 * Candidate D — Chart.js. See `ChartJsChart.vue` for what draws it.
 */
import CandidateFrame from '@/lab/chart-bakeoff/CandidateFrame.vue'
import CapabilityScorecard from '@/lab/chart-bakeoff/CapabilityScorecard.vue'
import ChartJsChart from '@/lab/chart-bakeoff/ChartJsChart.vue'
import { candidateBySlug } from '@/lab/chart-bakeoff/candidates'
import * as fixture from '@/lab/chart-bakeoff/fixture'
import { formatDateLong } from '@/lib/format'
import type { IsoDate } from '~~/domain/dates'

useHead({ title: 'chartjs — Chart bake-off - Runway' })

const report = candidateBySlug('chartjs')

const lastClicked = ref<IsoDate | null>(null)

function onSelectDay(date: IsoDate): void {
  lastClicked.value = date
}
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-6 p-6">
    <div class="space-y-1">
      <NuxtLink to="/lab/chart-bakeoff" class="text-sm text-muted-foreground underline underline-offset-4"
        >← All candidates</NuxtLink
      >
      <h1 class="text-xl font-semibold">Candidate D — Chart.js</h1>
      <p class="text-sm text-muted-foreground">
        <code>vue-chartjs</code> + <code>chartjs-plugin-annotation</code>, canvas renderer.
      </p>
    </div>

    <CandidateFrame>
      <ChartJsChart
        :days="fixture.days"
        :series="fixture.series"
        :combined="fixture.combined"
        :occurrences-by-day="fixture.occurrencesByDay"
        :cushion="fixture.cushion"
        :today-index="fixture.todayIndex"
        :lowest="fixture.lowest"
        :height="260"
        @select-day="onSelectDay"
      />
    </CandidateFrame>

    <p class="text-sm">
      <span class="font-medium">Capability 7 — last clicked point:</span>
      {{ lastClicked ? formatDateLong(lastClicked) : 'nothing clicked yet' }}
    </p>

    <CapabilityScorecard v-if="report" :report="report" />
  </div>
</template>
