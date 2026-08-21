<script setup lang="ts">
/**
 * "Will I make it?" — the shortfall calculator.
 *
 * A pure function of (target, cushion, projection): every keystroke or
 * selection re-evaluates immediately, with no submit step. All arithmetic —
 * the balance series, the low point, the margin — comes from
 * `domain/projection`; this page only holds the three inputs (mode, target,
 * cushion) and hands the engine's output to the two cards.
 */
import { computed, ref, watch } from 'vue'
import AppPage from '@/components/AppPage.vue'
import AskCard from '@/components/shortfall/AskCard.vue'
import VerdictCard from '@/components/shortfall/VerdictCard.vue'
import { useRunwayData } from '@/composables/useRunwayData'
import { useToday } from '@/composables/useToday'
import type { IsoDate } from '~~/domain/dates'
import { addDays } from '~~/domain/dates'
import type { MinorUnits } from '~~/domain/money'
import { evaluate, project, upcomingBills } from '~~/domain/projection'

useHead({ title: 'Will I Make It? - Runway' })

const { data } = useRunwayData()
const today = useToday()

const mode = ref<'bill' | 'date'>('bill')
const bills = computed(() => upcomingBills(data.value, today.value))

const selectedBillId = ref<string | null>(null)
// Preselects the first bill once the (today-dependent) list resolves, and
// re-anchors only if the current selection falls out of the list — switching
// tabs and back must restore the same row, not silently reset it.
watch(
  bills,
  (list) => {
    if (selectedBillId.value && list.some((bill) => bill.itemId === selectedBillId.value)) return
    selectedBillId.value = list[0]?.itemId ?? null
  },
  { immediate: true },
)

const selectedDate = ref<IsoDate>(addDays(today.value, 14))
const cushion = ref<MinorUnits>(0)

const targetDate = computed<IsoDate>(() => {
  if (mode.value === 'date') return selectedDate.value
  const bill = bills.value.find((candidate) => candidate.itemId === selectedBillId.value)
  return bill?.date ?? selectedDate.value
})

const projection = computed(() =>
  project(data.value, { start: today.value, end: targetDate.value }),
)
// The window opens on today, and `verdictFrom` defaults to the window's start,
// so the low point is searched over `[today, target]` inclusive — matching this
// screen's own copy, and unlike the dashboard's forward-looking verdict.
const verdict = computed(() => evaluate(projection.value.combinedSummary, cushion.value))
const todayBalance = computed<MinorUnits>(() => projection.value.combined[0]?.balance ?? 0)
</script>

<template>
  <AppPage
    title="Will I make it?"
    subtitle="Pick a bill or a date. We'll tell you if your cushion holds until then."
    center-title
  >
    <AskCard
      :mode="mode"
      :selected-bill-id="selectedBillId"
      :selected-date="selectedDate"
      :cushion="cushion"
      :bills="bills"
      :today="today"
      @update:mode="mode = $event"
      @update:selected-bill-id="selectedBillId = $event"
      @update:selected-date="selectedDate = $event"
      @update:cushion="cushion = $event"
    />
    <VerdictCard
      :verdict="verdict"
      :today-balance="todayBalance"
      :target-date="targetDate"
      :cushion="cushion"
      :today="today"
    />
  </AppPage>
</template>
