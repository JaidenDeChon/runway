<script setup lang="ts">
/**
 * "Will I make it?" — the shortfall calculator.
 *
 * A pure function of (target, cushion, projection): every keystroke or
 * selection re-evaluates immediately, with no submit step. All arithmetic —
 * the balance series, the low point, the margin — comes from
 * `domain/projection`; this page only holds the cushion draft and hands the
 * engine's output to the two cards. The target (mode, bill, date) is not
 * page state at all — `useShortfallTarget` computes it straight from the
 * route's query params, which is the single source of truth for it (issue
 * #14's Decision 2).
 */
import { watchDebounced } from '@vueuse/core'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import AppPage from '@/components/AppPage.vue'
import AskCard from '@/components/shortfall/AskCard.vue'
import VerdictCard from '@/components/shortfall/VerdictCard.vue'
import { Card } from '@/components/ui/card'
import { useRunwayData } from '@/composables/useRunwayData'
import { useShortfallTarget } from '@/composables/useShortfallTarget'
import { useToday } from '@/composables/useToday'
import { ARROW_LINK } from '@/lib/arrow-link'
import type { MinorUnits } from '~~/domain/money'
import {
  canAnswerShortfall,
  shortfallOutlook,
  shortfallThrough,
  upcomingBills,
} from '~~/domain/projection'

useHead({ title: 'Will I Make It? - Runway' })

const { data, isEmpty, safetyCushion, setSafetyCushion } = useRunwayData()
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
// this as the likely resolution; `resolveMode` (app/lib/shortfall-target.ts)
// falls back to date mode whenever there are no bills, whatever the URL asks
// for.
const target = useShortfallTarget(bills, today)

// The cushion the user is editing. Seeded from the stored one and re-synced
// whenever it changes, so the two can differ only for the few hundred
// milliseconds of a keystroke burst — never as two independent settings. This
// is the same `safetyCushion` the dashboard's chart draws its cushion line
// from, per issue #14's decision that Runway has one cushion, not two.
const cushion = ref<MinorUnits>(safetyCushion.value)
const cushionError = ref<string | null>(null)
watch(safetyCushion, (next) => {
  cushion.value = next
})

async function commitCushion(): Promise<void> {
  if (cushion.value === safetyCushion.value) return
  cushionError.value = null
  try {
    await setSafetyCushion(cushion.value)
  } catch {
    cushionError.value = "Couldn't save that cushion. Check your connection and try again."
  }
}

// Debounced so typing "600" is one write rather than three that can land out
// of order; the verdict itself does not wait, because `answer` below reads
// `cushion` directly.
watchDebounced(cushion, () => void commitCushion(), { debounce: 400 })
// A pending edit must not be lost to a navigation away — which is why the
// commit is a named function and not an inline closure.
onBeforeUnmount(() => void commitCushion())

// One engine call answers the whole screen. The shortfall is measured against
// the running minimum over `[today, target]` inclusive, not the closing balance
// — a window can end comfortably up and still dip below the cushion in the
// middle, and that dip is the thing this page exists to catch.
// `answer.through` rather than `target.through` reaches the card below: a
// target in the past is raised to today by the engine, and labelling the
// answer with the date that was asked for would caption a verdict about today
// with a day that has already been and gone.
const answer = computed(() =>
  shortfallThrough(data.value, {
    today: today.value,
    through: target.through.value,
    cushion: cushion.value,
  }),
)

// A second, target-independent projection over the whole selectable horizon —
// deliberately not derived from `answer` above. It answers a different
// question ("can any target the user picks move this verdict, and does the
// cushion break somewhere in the horizon even if it doesn't here") from the
// one `answer` asks about a single target. See `shortfallOutlook`.
const outlook = computed(() =>
  shortfallOutlook(data.value, { today: today.value, cushion: cushion.value }),
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
        :mode="target.mode.value"
        :selected-bill-id="target.billId.value"
        :selected-date="target.date.value"
        :cushion="cushion"
        :cushion-error="cushionError"
        :bills="bills"
        :today="today"
        @update:mode="target.setMode($event)"
        @update:selected-bill-id="target.setBillId($event)"
        @update:selected-date="target.setDate($event)"
        @update:cushion="cushion = $event"
      />
      <VerdictCard
        :verdict="answer"
        :today-balance="answer.startingBalance"
        :target-date="answer.through"
        :cushion="cushion"
        :today="today"
        :target-sensitive="outlook.isTargetSensitive"
        :first-breach="outlook.firstBreach"
      />
    </template>
  </AppPage>
</template>
