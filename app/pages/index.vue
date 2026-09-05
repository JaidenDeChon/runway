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
 * The two lists are the design's, and they are not the same thing. Saved edits
 * survive the editor closing; what-if edits are a preview that exists only while
 * the switch is on and is dropped the moment it goes off or the sheet closes.
 * Neither writes back to `useRunwayData()` — an override is a lens on stored
 * records, never a mutation of them.
 */

import AppPage from '@/components/AppPage.vue'
import BalanceForecastCard from '@/components/dashboard/BalanceForecastCard.vue'
import DayDetailEditor from '@/components/dashboard/DayDetailEditor.vue'
import LowestBalanceCard from '@/components/dashboard/LowestBalanceCard.vue'
import UpcomingCard from '@/components/dashboard/UpcomingCard.vue'
import UpdateBalancesEditor from '@/components/dashboard/UpdateBalancesEditor.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useChartDensity } from '@/composables/useChartDensity'
import { useIsDesktop } from '@/composables/useIsDesktop'
import { useRunwayData } from '@/composables/useRunwayData'
import { useToday } from '@/composables/useToday'
import { ARROW_LINK } from '@/lib/arrow-link'
import type { LegendEntry } from '@/lib/burndown'
import { chartLines } from '@/lib/burndown'
import type { BalanceReading } from '~~/domain/accounts'
import { balanceReadings } from '~~/domain/accounts'
import type { IsoDate } from '~~/domain/dates'
import { addDays, compareDates, daysBetween } from '~~/domain/dates'
import type { OccurrenceOverride } from '~~/domain/overrides'
import { withOverride } from '~~/domain/overrides'
import type { Occurrence } from '~~/domain/projection'
import { evaluate, project } from '~~/domain/projection'

useHead({ title: 'Home - Runway' })

/** The design's look-back: two weeks of already-happened balance, always. */
const LOOKBACK_DAYS = 14

const {
  data,
  accounts,
  accountsById,
  safetyCushion,
  isEmpty,
  isLoading,
  loadError,
  refresh,
  saveBalances,
} = useRunwayData()
const today = useToday()
const isDesktop = useIsDesktop()

const horizonDays = ref(30)
// Persisted in the browser for signed-out visitors, which is everyone today.
const density = useChartDensity()
const densityOpen = ref(false)

const savedOverrides = ref<OccurrenceOverride[]>([])
const whatIfOverrides = ref<OccurrenceOverride[]>([])
const whatIf = ref(false)

const editorOpen = ref(false)
const activeDate = ref<IsoDate | null>(null)

// Held as the *deselected* set rather than the selected one so an account added
// on another screen appears on the chart instead of silently missing from it.
const deselected = ref<string[]>([])

const selectedAccountIds = computed(() =>
  accounts.value.filter((account) => !deselected.value.includes(account.id)).map((a) => a.id),
)

// Empty is a legitimate data state ("no accounts yet"); a failed load leaves
// `accounts` empty too, and the two must never be confused — see the template,
// where the error case is checked first.
const showEmpty = computed(() => !isLoading.value && isEmpty.value)

const windowStart = computed(() => addDays(today.value, -LOOKBACK_DAYS))
const windowEnd = computed(() => addDays(today.value, horizonDays.value))

/** Saved first, what-if second, so a preview lands on top of a saved edit. */
const overrides = computed(() =>
  whatIf.value ? [...savedOverrides.value, ...whatIfOverrides.value] : savedOverrides.value,
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
    overrides: overrides.value,
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
    overrides: overrides.value,
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

const legend = computed<LegendEntry[]>(() =>
  accounts.value.map((account) => {
    const points = legendProjection.value.byAccount.find(
      (entry) => entry.accountId === account.id,
    )?.points
    return {
      accountId: account.id,
      name: account.name,
      color: account.color,
      // The legend figure is the balance at the *end* of the window, not today's.
      endingBalance: points?.[points.length - 1]?.balance ?? account.balance,
      checked: !deselected.value.includes(account.id),
      disabled: selectedAccountIds.value.length === 1 && selectedAccountIds.value[0] === account.id,
    }
  }),
)

function setAccountChecked(accountId: string, checked: boolean): void {
  if (checked) {
    deselected.value = deselected.value.filter((id) => id !== accountId)
    return
  }
  // Guarded here as well as in the legend's `disabled`: an empty chart has
  // nothing to say, and the design's silent rejection was the worse answer.
  if (selectedAccountIds.value.length <= 1) return
  deselected.value = [...deselected.value, accountId]
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
}

/** Closing always discards the what-if list — the design offers no confirmation. */
function setEditorOpen(open: boolean): void {
  editorOpen.value = open
  if (!open) setWhatIf(false)
}

function setWhatIf(on: boolean): void {
  whatIf.value = on
  if (!on) whatIfOverrides.value = []
}

function saveOverride(override: OccurrenceOverride): void {
  if (whatIf.value) {
    whatIfOverrides.value = withOverride(whatIfOverrides.value, override)
    return
  }
  savedOverrides.value = withOverride(savedOverrides.value, override)
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
        @update:horizon-days="(value) => (horizonDays = value)"
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
      :what-if="whatIf"
      @update:open="setEditorOpen"
      @update:what-if="setWhatIf"
      @save="saveOverride"
    />
  </AppPage>
</template>
