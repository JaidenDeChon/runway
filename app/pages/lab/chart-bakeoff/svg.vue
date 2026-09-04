<script setup lang="ts">
/**
 * Candidate A — the incumbent. `BurndownChart.vue` + `app/lib/burndown.ts`,
 * unmodified, fed the shared fixture.
 *
 * This file changes nothing under `app/components/dashboard/` — it only wires
 * the existing component to `app/lab/chart-bakeoff/fixture.ts` instead of a
 * live projection, and adds the harness chrome every candidate page carries.
 */
import BurndownChart from '@/components/dashboard/BurndownChart.vue'
import CandidateFrame from '@/lab/chart-bakeoff/CandidateFrame.vue'
import CapabilityScorecard from '@/lab/chart-bakeoff/CapabilityScorecard.vue'
import { candidateBySlug } from '@/lab/chart-bakeoff/candidates'
import * as fixture from '@/lab/chart-bakeoff/fixture'
import { DEFAULT_DENSITY } from '@/lib/burndown'
import { formatDateLong } from '@/lib/format'
import type { IsoDate } from '~~/domain/dates'

useHead({ title: 'svg — Chart bake-off - Runway' })

const report = candidateBySlug('svg')

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
      <h1 class="text-xl font-semibold">Candidate A — Incumbent SVG</h1>
      <p class="text-sm text-muted-foreground">
        <code>BurndownChart.vue</code> + <code>burndown.ts</code>, unmodified. Zero new dependencies.
      </p>
    </div>

    <CandidateFrame>
      <BurndownChart
        :days="fixture.days"
        :series="fixture.series"
        :combined="fixture.combined"
        :occurrences-by-day="fixture.occurrencesByDay"
        :cushion="fixture.cushion"
        :today-index="fixture.todayIndex"
        :lowest="fixture.lowest"
        :status="fixture.status"
        :density="DEFAULT_DENSITY"
        :horizon-days="fixture.horizonDays"
        :desktop="false"
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
