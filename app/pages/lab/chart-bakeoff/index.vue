<script setup lang="ts">
/**
 * Issue #10 — chart-library bake-off. Entry point for the harness: links to
 * every candidate page and, side by side, the scorecard recorded for each.
 *
 * This page's own bundle carries no chart library — it imports only
 * `candidates.ts` and `capabilities.ts`, plain data modules. Which candidate
 * *pages* actually exist depends on `RUNWAY_LAB` (see `nuxt.config.ts`); in
 * per-slug mode most of these links 404, which is expected — that mode exists
 * for `scripts/bakeoff-bundle.ts` to measure one candidate in isolation, not
 * for a reviewer to browse from here.
 */
import CapabilityScorecard from '@/lab/chart-bakeoff/CapabilityScorecard.vue'
import { CANDIDATES } from '@/lab/chart-bakeoff/candidates'

useHead({ title: 'Chart library bake-off - Runway' })

const roleLabel: Record<string, string> = {
  incumbent: 'Incumbent',
  baseline: 'Designated baseline',
  challenger: 'Challenger',
}
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-8 p-6">
    <div class="space-y-2">
      <h1 class="text-xl font-semibold">Chart library bake-off</h1>
      <p class="text-sm text-muted-foreground">
        Issue #10. Every candidate below renders the same fixed fixture
        (<code>createShortSeedData()</code> projected at <code>SEED_TODAY</code>) through the same
        <code>project()</code> call — see <code>app/lab/chart-bakeoff/fixture.ts</code>. This tree
        does not exist in a production build; it is compiled only when
        <code>RUNWAY_LAB</code> is set. See <code>docs/spikes/chart-library-bakeoff.md</code> for the
        write-up.
      </p>
    </div>

    <ul class="space-y-8">
      <li v-for="candidate in CANDIDATES" :key="candidate.slug" class="space-y-2">
        <div class="flex flex-wrap items-baseline gap-2">
          <h2 class="text-base font-medium">
            <NuxtLink :to="`/lab/chart-bakeoff/${candidate.slug}`" class="underline underline-offset-4">
              {{ candidate.name }}
            </NuxtLink>
          </h2>
          <span class="text-xs font-medium text-muted-foreground">{{ roleLabel[candidate.role] }}</span>
        </div>
        <CapabilityScorecard :report="candidate" />
      </li>
    </ul>
  </div>
</template>
