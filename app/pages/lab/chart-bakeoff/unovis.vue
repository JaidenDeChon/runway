<script setup lang="ts">
/**
 * Candidate B — the designated baseline. See `UnovisChart.vue` for what draws
 * it; this page only wires the shared fixture into it and adds the harness
 * chrome every candidate page carries.
 */
import CandidateFrame from '@/lab/chart-bakeoff/CandidateFrame.vue'
import CapabilityScorecard from '@/lab/chart-bakeoff/CapabilityScorecard.vue'
import { candidateBySlug } from '@/lab/chart-bakeoff/candidates'
import * as fixture from '@/lab/chart-bakeoff/fixture'
import UnovisChart from '@/lab/chart-bakeoff/UnovisChart.vue'

useHead({ title: 'unovis — Chart bake-off - Runway' })

const report = candidateBySlug('unovis')
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-6 p-6">
    <div class="space-y-1">
      <NuxtLink to="/lab/chart-bakeoff" class="text-sm text-muted-foreground underline underline-offset-4"
        >← All candidates</NuxtLink
      >
      <h1 class="text-xl font-semibold">Candidate B — Designated baseline (@unovis/vue)</h1>
      <p class="text-sm text-muted-foreground">
        The shadcn-vue <code>chart</code> registry item's chassis, drawing with <code>@unovis/vue</code>.
      </p>
    </div>

    <CandidateFrame>
      <UnovisChart
        :days="fixture.days"
        :series="fixture.series"
        :combined="fixture.combined"
        :occurrences-by-day="fixture.occurrencesByDay"
        :cushion="fixture.cushion"
        :today-index="fixture.todayIndex"
        :lowest="fixture.lowest"
        :height="260"
      />
    </CandidateFrame>

    <CapabilityScorecard v-if="report" :report="report" />
  </div>
</template>
