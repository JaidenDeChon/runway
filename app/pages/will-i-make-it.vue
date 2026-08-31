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
import { Card } from '@/components/ui/card'
import { useRunwayData } from '@/composables/useRunwayData'
import { useToday } from '@/composables/useToday'
import { ARROW_LINK } from '@/lib/arrow-link'
import type { IsoDate } from '~~/domain/dates'
import { addDays } from '~~/domain/dates'
import type { MinorUnits } from '~~/domain/money'
import { canAnswerShortfall, shortfallThrough, upcomingBills } from '~~/domain/projection'

useHead({ title: 'Will I Make It? - Runway' })

const { data, isEmpty } = useRunwayData()
const today = useToday()

const bills = computed(() => upcomingBills(data.value, today.value))

/**
 * What is missing before this screen can answer at all, or `null` once it can.
 *
 * Two gaps, one shape. Both render the dashboard's empty-state card rather
 * than a verdict, because a verdict is exactly what neither state has: with no
 * account there is no balance to project, and with a balance but nothing
 * spending it the engine returns a truthful **Covered** that means nothing —
 * see `canAnswerShortfall`, which owns that rule because it is a product
 * decision about honesty, not a rendering one.
 *
 * Deviation raised per CLAUDE.md rather than resolved silently: `spec.md`'s
 * Open Question 7 covers only the no-bills case and only as far as the *tab*
 * ("hide or disable"), and there is no `screens/empty.png` for either state,
 * so the copy here is invented.
 */
const gap = computed(() => {
  if (isEmpty.value) {
    return {
      heading: 'Nothing to check yet',
      body: "Add the account you spend from so there's a balance to project forward.",
      cta: 'Add an account',
      to: '/accounts',
    }
  }
  if (!canAnswerShortfall(data.value)) {
    return {
      heading: 'Not enough to go on yet',
      body: "A balance on its own can't say whether you'll make it. Add the bills that come out of it and we'll project against them.",
      cta: 'Add a recurring item',
      to: '/recurring-items',
    }
  }
  return null
})

// Bill mode has nothing to point at with no upcoming bills — spec.md's Open
// Question 7 leaves this state undecided ("no copy exists for it") and names
// this as the likely resolution. Set once, from whatever `bills` resolves to
// at mount: nothing on this page changes the recurring-item list out from
// under itself while it stays mounted, so there is no live household event to
// react to afterward.
const mode = ref<'bill' | 'date'>(bills.value.length > 0 ? 'bill' : 'date')

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

// One engine call answers the whole screen. The shortfall is measured against
// the running minimum over `[today, target]` inclusive, not the closing balance
// — a window can end comfortably up and still dip below the cushion in the
// middle, and that dip is the thing this page exists to catch.
// `answer.through` rather than `targetDate` reaches the card below: a target in
// the past is raised to today by the engine, and labelling the answer with the
// date that was asked for would caption a verdict about today with a day that
// has already been and gone.
const answer = computed(() =>
  shortfallThrough(data.value, {
    today: today.value,
    through: targetDate.value,
    cushion: cushion.value,
  }),
)
</script>

<template>
  <AppPage
    title="Will I make it?"
    subtitle="Pick a bill or a date. We'll tell you if your cushion holds until then."
    center-title
  >
    <!-- The ask and verdict cards are absent from the DOM in this state, not
         merely hidden: VerdictCard carries an aria-live region, and a
         suppressed-but-mounted one would announce a stale answer. -->
    <Card v-if="gap" class="gap-2">
      <div class="px-4 lg:px-6">
        <h2 class="text-base font-medium">{{ gap.heading }}</h2>
        <p class="mt-1 text-sm text-muted-foreground">{{ gap.body }}</p>
        <NuxtLink :to="gap.to" :class="[ARROW_LINK, 'mt-3']">
          {{ gap.cta }}<span aria-hidden="true"> →</span>
        </NuxtLink>
      </div>
    </Card>

    <template v-else>
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
        :verdict="answer"
        :today-balance="answer.startingBalance"
        :target-date="answer.through"
        :cushion="cushion"
        :today="today"
      />
    </template>
  </AppPage>
</template>
