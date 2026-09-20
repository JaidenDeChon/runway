<script setup lang="ts">
/**
 * The burndown dashboard — how far the money goes, and when it gets uncomfortable.
 *
 * This screen holds the only responsive grid in the app (`"chart stat" /
 * "events events"`, 340px second column) and the only wide container. The
 * max-width conflict the spec flags as blocking is resolved by `AppPage`'s
 * enumerated `width` prop rather than here; see the note in that component.
 *
 * Everything numeric is `project()` / `evaluate()` output. The page's own state
 * is entirely about *which* projection to ask for: the horizon, which accounts
 * are in it, and two override lists.
 *
 * Issue #15 moved the saved list off this page's own `useState`-in-a-ref and
 * onto real rows: `data.value.occurrenceOverrides` (from `useRunwayData()`,
 * ultimately `public.occurrences`) is what the engine now layers in
 * automatically, unconditionally, every time it expands occurrences — a
 * saved edit needs no `overrides` passed here at all. `whatIfOverrides` is
 * still an in-memory preview list, passed as `window.overrides` only while
 * what-if is on and never written back to `useRunwayData()` — a preview is a
 * lens on stored records, never a mutation of them.
 *
 * Issue #16 moved that list's rules into `app/lib/what-if.ts`, where they are
 * under unit test, and made the isolation enforceable rather than merely
 * true: `tests/guards/what-if-write-isolation.test.ts` reads this file. It
 * also made what-if a property of *this page* rather than of the day editor
 * — see `setEditorOpen` below for why, and for the spec deviation that
 * carries. The mode now ends in exactly three ways: the switch, the bar's
 * exit, or this component going away (reload, navigation, an expired
 * session), which is the clean discard the issue asks for and costs no code.
 */

import AppPage from '@/components/AppPage.vue'
import BalanceForecastCard from '@/components/dashboard/BalanceForecastCard.vue'
import DayDetailEditor from '@/components/dashboard/DayDetailEditor.vue'
import LowestBalanceCard from '@/components/dashboard/LowestBalanceCard.vue'
import UpcomingCard from '@/components/dashboard/UpcomingCard.vue'
import UpdateBalancesEditor from '@/components/dashboard/UpdateBalancesEditor.vue'
import WhatIfBar from '@/components/dashboard/WhatIfBar.vue'
import ResponsiveEditor from '@/components/ResponsiveEditor.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useChartDensity } from '@/composables/useChartDensity'
import { useIsDesktop } from '@/composables/useIsDesktop'
import { useRunwayData } from '@/composables/useRunwayData'
import { useToday } from '@/composables/useToday'
import {
  endingBalances,
  legendEntries,
  nextHiddenAccounts,
  visibleAccountIds,
} from '@/lib/account-selection'
import { ARROW_LINK } from '@/lib/arrow-link'
import type { LegendEntry } from '@/lib/burndown'
import { chartLines } from '@/lib/burndown'
import type { OccurrenceEdit, OccurrenceRevert } from '@/lib/occurrence-editor'
import {
  discardPrompt,
  EMPTY_SCRATCH,
  hasScratchEdits,
  overridesInEffect,
  PROMOTION_STALE,
  promotionFailureMessage,
  promotionPlan,
  type WhatIfScratch,
  withScratchEdit,
} from '@/lib/what-if'
import type { BalanceReading } from '~~/domain/accounts'
import { balanceReadings } from '~~/domain/accounts'
import type { IsoDate } from '~~/domain/dates'
import { addDays, compareDates, daysBetween } from '~~/domain/dates'
import type { MinorUnits } from '~~/domain/money'
import type { OccurrenceOverride } from '~~/domain/overrides'
import type { Occurrence } from '~~/domain/projection'
import { evaluate, project } from '~~/domain/projection'

useHead({ title: 'Home - Runway' })

/** The design's look-back: two weeks of already-happened balance, always. */
const LOOKBACK_DAYS = 14

const {
  data,
  accounts,
  accountsById,
  recurringItems,
  safetyCushion,
  isEmpty,
  isLoading,
  loadError,
  refresh,
  saveBalances,
  defaultHorizonDays,
  hiddenAccountIds,
  setAccountHidden,
  setDefaultHorizonDays,
  overrideOccurrence,
  revertOccurrence,
  splitRecurringItem,
} = useRunwayData()
const today = useToday()
const isDesktop = useIsDesktop()

// Read from useRunwayData() rather than held as a ref: the horizon is a
// stored preference (user_settings.default_horizon_days), so the page has
// nothing of its own to track. The write side is the ToggleGroup's
// `@update:horizon-days` binding below, straight through to `setDefaultHorizonDays`.
const horizonDays = computed(() => defaultHorizonDays.value)
// Device-local by decision, not because sign-in never landed — see
// useChartDensity's own comment and docs/design/dashboard/spec.md. Whether it
// should follow a signed-in user to a second device is deferred to #72.
const density = useChartDensity()
const densityOpen = ref(false)

// The scratch list a what-if session accumulates. Page-local by design and
// held nowhere else: no `useState`, no storage, no round trip. A reload,
// a navigation or an expired session takes this component down and the
// previews with it, which is the discard behaviour issue #16 asks for rather
// than something built on top. `app/lib/what-if.ts` owns the rules it follows.
const whatIfOverrides = ref<WhatIfScratch>(EMPTY_SCRATCH)
const whatIf = ref(false)

const editorOpen = ref(false)
const activeDate = ref<IsoDate | null>(null)
const savingEdit = ref(false)
const editError = ref<string | null>(null)

/** Looked up for the apply-to-future consequence sentence — `Cadence` lives on the rule, not the `Occurrence`. */
const recurringItemsById = computed(
  () => new Map(recurringItems.value.map((item) => [item.id, item])),
)

// Held as the *hidden* set rather than the shown one so an account added on
// another screen appears on the chart instead of silently missing from it —
// now `useRunwayData().hiddenAccountIds`, stored in
// `public.dashboard_hidden_accounts` under the user's own session rather than
// held only in this page's memory.
const selectedAccountIds = computed(() => visibleAccountIds(accounts.value, hiddenAccountIds.value))

// Empty is a legitimate data state ("no accounts yet"); a failed load leaves
// `accounts` empty too, and the two must never be confused — see the template,
// where the error case is checked first.
const showEmpty = computed(() => !isLoading.value && isEmpty.value)

const windowStart = computed(() => addDays(today.value, -LOOKBACK_DAYS))
const windowEnd = computed(() => addDays(today.value, horizonDays.value))

// The saved list is no longer read here at all: `data.value.occurrenceOverrides`
// is layered in unconditionally by `occurrencesIn` itself
// (domain/projection.ts). What-if is still a preview passed through
// `window.overrides` and lands on top of the saved edits the engine already
// applied, exactly as `domain/overrides.ts`'s doc comment on `ProjectionWindow.overrides` says.
const previewOverrides = computed<readonly OccurrenceOverride[]>(() =>
  overridesInEffect(whatIf.value, whatIfOverrides.value),
)

/**
 * Whether the accounts' readings describe one moment.
 *
 * The check is the domain's — a component must not decide what "stale" means —
 * and it gates a warning inside the forecast card, directly above the chart,
 * rather than changing the forecast.
 * The engine projects what it is given; this tells the user that what it was
 * given disagrees with itself.
 */
const readings = computed(() => balanceReadings(accounts.value))
const balancesOpen = ref(false)
const savingBalances = ref(false)
const balancesError = ref<string | null>(null)

async function recordBalances(readings: BalanceReading[]): Promise<void> {
  savingBalances.value = true
  balancesError.value = null
  try {
    await saveBalances(readings, today.value)
    balancesOpen.value = false
  } catch {
    balancesError.value = 'Could not save those balances. Check your connection and try again.'
  } finally {
    savingBalances.value = false
  }
}

const projection = computed(() =>
  project(data.value, {
    start: windowStart.value,
    end: windowEnd.value,
    accountIds: selectedAccountIds.value,
    overrides: previewOverrides.value,
    // A dip that has already happened is history, not a forecast, so the
    // verdict starts the day after today even though the chart opens earlier.
    verdictFrom: addDays(today.value, 1),
  }),
)

/**
 * The same window over *every* account, for the legend only.
 *
 * The legend shows each account's closing balance whether or not its line is on
 * the chart, so it cannot read from a projection the selection has narrowed —
 * deselecting an account would otherwise replace its figure with today's.
 */
const legendProjection = computed(() =>
  project(data.value, {
    start: windowStart.value,
    end: windowEnd.value,
    overrides: previewOverrides.value,
  }),
)

/** Index of today in the series — the origin for ticks, the rule, and the verdict. */
const todayIndex = computed(() => daysBetween(windowStart.value, today.value))

/**
 * The series-count rule — one line per resolved account, plus a combined line
 * only once two or more of those actually draw — lives in `chartLines`, not
 * here: it is a data-shaping rule, not view state, and is unit-tested on its
 * own in `app/lib/burndown.test.ts`.
 */
const lines = computed(() =>
  chartLines(projection.value.byAccount, projection.value.combined, accountsById.value),
)

// The projection is already narrowed to the selected accounts, so its combined
// line *is* the single account's line when only one is selected — the verdict
// reads one summary either way, and the engine found that low point in the same
// pass that built the series.
const verdict = computed(() => evaluate(projection.value.combinedSummary, safetyCushion.value))

const occurrencesByDay = computed(() => {
  const byDay = new Map<IsoDate, Occurrence[]>()
  for (const occurrence of projection.value.occurrences) {
    const existing = byDay.get(occurrence.date)
    if (existing) existing.push(occurrence)
    else byDay.set(occurrence.date, [occurrence])
  }
  return byDay as ReadonlyMap<IsoDate, readonly Occurrence[]>
})

/** Upcoming is forward-looking only; the look-back belongs to the chart. */
const upcoming = computed(() =>
  projection.value.occurrences.filter(
    (occurrence) => compareDates(occurrence.date, today.value) >= 0,
  ),
)

// The legend figure is the balance at the *end* of the window, not today's —
// read from `summary.ending`, which `project()` already found in the same
// pass that built the series, never by indexing a series' last point.
const legend = computed<LegendEntry[]>(() =>
  legendEntries(
    accounts.value,
    endingBalances(legendProjection.value.byAccount),
    hiddenAccountIds.value,
  ),
)

function setAccountChecked(accountId: string, checked: boolean): void {
  // `nextHiddenAccounts` is the tested rule — including the guard that
  // refuses to hide the last visible account, matching the legend's own
  // `disabled` — so this function does not compute the next set itself.
  const next = nextHiddenAccounts(
    hiddenAccountIds.value,
    selectedAccountIds.value,
    accountId,
    checked,
  )
  if (next === null) return
  void setAccountHidden(accountId, !checked)
}

const activeOccurrences = computed<readonly Occurrence[]>(() =>
  activeDate.value ? (occurrencesByDay.value.get(activeDate.value) ?? []) : [],
)

/** The day's running balances — the thing the tooltip shows and touch cannot reach. */
const activeBalances = computed(() => {
  if (!activeDate.value) return []
  const index = daysBetween(windowStart.value, activeDate.value)
  const rows = lines.value.series.flatMap((entry) => {
    const point = entry.points[index]
    return point ? [{ key: entry.id, name: entry.name, balance: point.balance }] : []
  })
  const combinedPoint = lines.value.combined?.[index]
  if (combinedPoint)
    rows.push({ key: 'combined', name: 'Combined', balance: combinedPoint.balance })
  return rows
})

function openDay(date: IsoDate): void {
  activeDate.value = date
  editorOpen.value = true
  // A stale failure from a previous edit must not bleed into the next one.
  editError.value = null
}

/**
 * Closing the editor leaves what-if running.
 *
 * **This is a deliberate deviation from `docs/design/dashboard/spec.md`
 * (~line 251), raised in the PR rather than resolved quietly.** The spec has
 * Done / ✕ / overlay tap close the editor *and* turn what-if off. But issue
 * #16 asks for a mode that is unmistakable at every scroll position and that
 * discards cleanly on navigate-away and reload — and under the spec's
 * behaviour none of that can mean anything, because the editor is a modal:
 * while it is open the page behind it is inert and scroll-locked, and the
 * moment it closes the mode is gone. There is no scroll position at which
 * the mode both exists and is visible.
 *
 * So the mode outlives the editor. You preview a change, close the sheet,
 * and read the whole dashboard — chart, Upcoming, verdict — under it. That
 * is what "mode" means, and it is what makes the persistent bar, the exit
 * confirmation and promotion worth having at all.
 *
 * Closing therefore discards nothing and asks nothing. The two ways out that
 * *do* discard both confirm first: the switch inside the editor, and the
 * bar's "Exit what-if".
 */
function setEditorOpen(open: boolean): void {
  editorOpen.value = open
}

function setWhatIf(on: boolean): void {
  whatIf.value = on
  if (!on) whatIfOverrides.value = EMPTY_SCRATCH
}

/**
 * The bar's own exit confirmation.
 *
 * A second implementation of the same question, and the duplication is the
 * point rather than an oversight: the two routes out are never reachable at
 * the same time. The switch lives inside a modal, where the answer has to be
 * a swapped body (`DayDetailEditor` — nesting a dialog over a bottom sheet
 * at 375px leaves neither readable); the bar is only reachable once that
 * modal is closed, where a dialog is the ordinary answer and a swapped body
 * has nothing to swap. They share the sentence (`discardPrompt`) and the
 * condition, which is the part worth having in one place.
 */
const exitConfirmOpen = ref(false)

function requestWhatIfExit(): void {
  if (!hasScratchEdits(whatIfOverrides.value)) {
    setWhatIf(false)
    return
  }
  exitConfirmOpen.value = true
}

function confirmWhatIfExit(): void {
  exitConfirmOpen.value = false
  setWhatIf(false)
}

const promoting = ref(false)
const promoteError = ref<string | null>(null)

/**
 * The rule's own amount for an occurrence, read out of the projection the
 * engine has already computed.
 *
 * `scratchEntry` drops `projectedAmount` on the way in, because a preview has
 * no business carrying a field that exists only for a write
 * (`app/lib/what-if.ts` says why). Promotion therefore has to re-derive it.
 *
 * Reading it off `projection` is safe even though that projection has the
 * previews layered into it: `applyOne` rewrites `amount`, `date`,
 * `isOverridden` and `id`, and never touches `projectedAmount` or
 * `projectedDate` (`domain/overrides.ts`). Those two stay the occurrence's
 * identity and the rule's own figure — which is exactly what
 * `override_occurrence`'s insert branch wants for a date that is not
 * materialized yet. A previewed value here would corrupt the stored row.
 */
function projectedAmountFor(itemId: string, date: IsoDate): MinorUnits | null {
  const match = projection.value.occurrences.find(
    (occurrence) => occurrence.itemId === itemId && occurrence.projectedDate === date,
  )
  return match ? match.projectedAmount : null
}

/**
 * Turns the previews into real saved edits (issue #16).
 *
 * Routed through the same `overrideOccurrence` / `splitRecurringItem` the
 * editor uses with what-if off — that is the acceptance criterion, and it is
 * also what keeps `tests/guards/occurrence-write-sites.test.ts` true: there
 * is still exactly one write path per RPC.
 *
 * **Sequential, in the order the user made them.** Not `Promise.all`: two
 * edits can touch the same rule, and a split regenerates that rule's
 * occurrences, so overlapping writes would race. List order is also what
 * makes a promoted result identical to making the same edits directly with
 * the mode off, which is the criterion as written.
 *
 * `projectedAmountFor` is called inside the loop rather than once up front,
 * because a split earlier in the list changes the rule's own amounts for
 * every date after it; reading the projection again after each await picks
 * that up instead of writing a figure that was true before the split.
 *
 * On any failure it stops and keeps the remaining previews, so a partial
 * promotion leaves the user with the rest of their session rather than
 * silently dropping it. The writes already made stand — they are real edits,
 * and rolling them back would need a transaction this seam does not have.
 */
async function promoteWhatIf(): Promise<void> {
  // The button disables itself on `saving`, but that is a prop round trip;
  // a double press inside it would run the whole plan twice.
  if (promoting.value) return
  promoting.value = true
  promoteError.value = null
  try {
    for (const step of promotionPlan(whatIfOverrides.value)) {
      if (step.kind === 'split') {
        await splitRecurringItem({
          itemId: step.itemId,
          effectiveFrom: step.effectiveFrom,
          amount: step.amount,
          today: today.value,
        })
      } else {
        const projectedAmount = projectedAmountFor(step.itemId, step.date)
        if (projectedAmount === null) {
          // Distinct from the failure below on purpose: this one is not a
          // connection problem, and telling somebody to check their network
          // when the horizon moved under them sends them after the wrong
          // thing. Reachable when an earlier split in this same run pushed
          // the day out of the projected window.
          promoteError.value = PROMOTION_STALE
          return
        }
        await overrideOccurrence({
          itemId: step.itemId,
          date: step.date,
          amount: step.amount,
          projectedAmount,
          ...(step.newDate ? { newDate: step.newDate } : {}),
        })
      }
      // Dropped one at a time, so a failure halfway leaves exactly the
      // previews that have not been written yet — and the chart keeps
      // showing them, now layered over the edits that did land.
      const previewedDate = step.kind === 'split' ? step.effectiveFrom : step.date
      whatIfOverrides.value = whatIfOverrides.value.filter(
        (entry) => entry.itemId !== step.itemId || entry.date !== previewedDate,
      )
    }
    setWhatIf(false)
  } catch (error) {
    // The seam has already logged the RPC's own code; this adds which of the
    // two occurrence writes was running, which `occurrence edit failed` alone
    // does not say. A marker, never an amount — see CLAUDE.md on logging.
    console.error('what-if promotion failed', {
      marker: error instanceof Error ? error.message : 'unknown',
    })
    promoteError.value = promotionFailureMessage(error)
  } finally {
    promoting.value = false
  }
}

/**
 * A previewed edit, which is the entirety of what-if's write story: it lands
 * in an in-memory list and stops there.
 *
 * Split out of `saveOccurrenceEdit` below so the claim is checkable rather
 * than merely true — `tests/guards/what-if-write-isolation.test.ts` reads this
 * function's body and fails the build if any mutation from the
 * `useRunwayData()` seam ever appears inside it. Keep it that way: promotion,
 * when it arrives, is a separate deliberate act with a name of its own, not a
 * line added here.
 */
function previewOccurrenceEdit(edit: OccurrenceEdit): void {
  whatIfOverrides.value = withScratchEdit(whatIfOverrides.value, edit)
}

/**
 * What-if previews still never touch the database — this is the one branch
 * that keeps `saveOccurrenceEdit`'s name honest despite doing no saving at
 * all when the switch is on. A real save dispatches on `edit.scope`:
 * `overrideOccurrence` for "this occurrence only", `splitRecurringItem` for
 * "apply to all future" — the amount there is converted to the positive
 * magnitude `recurring_rules.amount_cents` expects, since `OccurrenceEdit.amount`
 * is always signed like `Occurrence.amount`, regardless of scope.
 */
async function saveOccurrenceEdit(edit: OccurrenceEdit): Promise<void> {
  if (whatIf.value) {
    previewOccurrenceEdit(edit)
    return
  }

  savingEdit.value = true
  editError.value = null
  try {
    if (edit.scope === 'once') {
      await overrideOccurrence({
        itemId: edit.itemId,
        date: edit.date,
        amount: edit.amount,
        projectedAmount: edit.projectedAmount,
        ...(edit.newDate ? { newDate: edit.newDate } : {}),
      })
    } else {
      await splitRecurringItem({
        itemId: edit.itemId,
        effectiveFrom: edit.date,
        amount: Math.abs(edit.amount),
        today: today.value,
      })
    }
  } catch {
    editError.value = 'Could not save that change. Check your connection and try again.'
  } finally {
    savingEdit.value = false
  }
}

async function revertOccurrenceEdit(target: OccurrenceRevert): Promise<void> {
  savingEdit.value = true
  editError.value = null
  try {
    await revertOccurrence(target.itemId, target.date, today.value)
  } catch {
    editError.value = 'Could not revert that change. Check your connection and try again.'
  } finally {
    savingEdit.value = false
  }
}
</script>

<template>
  <AppPage width="wide">
    <h1 class="sr-only">Dashboard</h1>

    <Card v-if="loadError" class="gap-2">
      <Alert variant="destructive" class="m-4 w-auto">
        <AlertTitle>{{ loadError }}</AlertTitle>
        <AlertDescription>
          <Button type="button" variant="outline" size="sm" class="mt-2" @click="refresh">
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    </Card>

    <Card v-else-if="showEmpty" class="gap-2">
      <div class="px-4 lg:px-6">
        <h2 class="text-base font-medium">Nothing to forecast yet</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          Add the account you spend from and the bills that hit it, and this becomes your balance
          forecast.
        </p>
        <NuxtLink
          to="/accounts"
          :class="[ARROW_LINK, 'mt-3']"
        >
          Add an account<span aria-hidden="true"> →</span>
        </NuxtLink>
      </div>
    </Card>

    <template v-else>
      <div class="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-5">
      <BalanceForecastCard
        :days="projection.days"
        :series="lines.series"
        :combined="lines.combined"
        :occurrences-by-day="occurrencesByDay"
        :legend="legend"
        :readings="readings"
        :accounts-by-id="accountsById"
        :cushion="safetyCushion"
        :today-index="todayIndex"
        :lowest="verdict.lowest"
        :status="verdict.status"
        :horizon-days="horizonDays"
        :density="density"
        :density-open="densityOpen"
        :loading="isLoading"
        :what-if="whatIf"
        :desktop="isDesktop"
        @update:horizon-days="(value) => void setDefaultHorizonDays(value)"
        @update:density="(value) => (density = value)"
        @update:density-open="(value) => (densityOpen = value)"
        @update:account-checked="setAccountChecked"
        @update-balances="balancesOpen = true"
        @select-day="openDay"
      />

      <LowestBalanceCard :verdict="verdict" :today="today" />

        <UpcomingCard
          class="lg:col-span-2"
          :occurrences="upcoming"
          :accounts-by-id="accountsById"
          :horizon-days="horizonDays"
          :today="today"
          @select-day="openDay"
        />
      </div>

      <UpdateBalancesEditor
        :open="balancesOpen"
        :accounts="accounts"
        :today="today"
        :newest-on-file="readings.newest"
        :saving="savingBalances"
        :error="balancesError"
        @update:open="(value) => (balancesOpen = value)"
        @save="recordBalances"
      />
    </template>

    <DayDetailEditor
      :open="editorOpen"
      :date="activeDate"
      :occurrences="activeOccurrences"
      :balances="activeBalances"
      :accounts-by-id="accountsById"
      :recurring-items-by-id="recurringItemsById"
      :what-if="whatIf"
      :what-if-edit-count="whatIfOverrides.length"
      :saving="savingEdit"
      :error="editError"
      @update:open="setEditorOpen"
      @update:what-if="setWhatIf"
      @save="saveOccurrenceEdit"
      @revert="revertOccurrenceEdit"
    />

    <!-- Keeps the last card scrollable clear of the fixed bar. Rendered only
         while the bar is, so the page has no dead space the rest of the time. -->
    <div v-if="whatIf" class="h-20" aria-hidden="true" />
    <WhatIfBar
      v-if="whatIf"
      :edit-count="whatIfOverrides.length"
      :saving="promoting"
      :error="promoteError"
      @exit="requestWhatIfExit"
      @promote="promoteWhatIf"
    />

    <ResponsiveEditor
      :open="exitConfirmOpen"
      title="Discard what-if changes?"
      :description="discardPrompt(whatIfOverrides.length)"
      @update:open="(value) => (exitConfirmOpen = value)"
    >
      <div class="flex flex-col gap-2 lg:flex-row-reverse">
        <Button type="button" class="lg:flex-1" @click="exitConfirmOpen = false">
          Keep previewing
        </Button>
        <Button type="button" variant="outline" class="lg:flex-1" @click="confirmWhatIfExit">
          Discard changes
        </Button>
      </div>
    </ResponsiveEditor>
  </AppPage>
</template>
