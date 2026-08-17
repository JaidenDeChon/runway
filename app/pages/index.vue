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
import { Card } from '@/components/ui/card'
import { useChartDensity } from '@/composables/useChartDensity'
import { useIsDesktop } from '@/composables/useIsDesktop'
import { useRunwayData } from '@/composables/useRunwayData'
import { useToday } from '@/composables/useToday'
import { accountColorVar } from '@/lib/account-colors'
import type { ChartSeries, LegendEntry } from '@/lib/burndown'
import type { IsoDate } from '~~/domain/dates'
import { addDays, compareDates, daysBetween } from '~~/domain/dates'
import type { OccurrenceOverride } from '~~/domain/overrides'
import { withOverride } from '~~/domain/overrides'
import type { DayPoint, Occurrence } from '~~/domain/projection'
import { evaluate, project } from '~~/domain/projection'

useHead({ title: 'Home - Runway' })

/** The design's look-back: two weeks of already-happened balance, always. */
const LOOKBACK_DAYS = 14

/** How long the export holds the skeleton before swapping in the chart. */
const LOAD_DELAY_MS = 550

const { data, accounts, accountsById, safetyCushion, isEmpty } = useRunwayData()
const today = useToday()
const isDesktop = useIsDesktop()

const horizonDays = ref(30)
// Persisted in the browser for signed-out visitors, which is everyone today.
const density = useChartDensity()
const densityOpen = ref(false)
const loading = ref(true)

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

let loadTimer: ReturnType<typeof setTimeout> | undefined

onMounted(() => {
  loadTimer = setTimeout(() => {
    loading.value = false
  }, LOAD_DELAY_MS)
})

onBeforeUnmount(() => clearTimeout(loadTimer))

const windowStart = computed(() => addDays(today.value, -LOOKBACK_DAYS))
const windowEnd = computed(() => addDays(today.value, horizonDays.value))

/** Saved first, what-if second, so a preview lands on top of a saved edit. */
const overrides = computed(() =>
  whatIf.value ? [...savedOverrides.value, ...whatIfOverrides.value] : savedOverrides.value,
)

const projection = computed(() =>
  project(data.value, {
    start: windowStart.value,
    end: windowEnd.value,
    accountIds: selectedAccountIds.value,
    overrides: overrides.value,
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

/** The combined line only exists once there are two lines to combine. */
const combined = computed<readonly DayPoint[] | null>(() =>
  selectedAccountIds.value.length > 1 ? projection.value.combined : null,
)

const series = computed<ChartSeries[]>(() =>
  projection.value.byAccount.flatMap((entry) => {
    const account = accountsById.value.get(entry.accountId)
    if (!account) return []
    return [
      {
        id: account.id,
        name: account.name,
        stroke: accountColorVar(account.color),
        points: entry.points,
      },
    ]
  }),
)

/** The line the verdict is read from: combined when there is one, else the only account. */
const verdictPoints = computed<readonly DayPoint[]>(
  () => combined.value ?? series.value[0]?.points ?? [],
)

const verdict = computed(() =>
  // `from` is the day after today: a dip that has already happened is history,
  // not a forecast.
  evaluate(verdictPoints.value, safetyCushion.value, { from: todayIndex.value + 1 }),
)

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
  const rows = series.value.flatMap((entry) => {
    const point = entry.points[index]
    return point ? [{ key: entry.id, name: entry.name, balance: point.balance }] : []
  })
  const combinedPoint = combined.value?.[index]
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

    <Card v-if="isEmpty" class="gap-2">
      <div class="px-4 lg:px-6">
        <h2 class="text-base font-medium">Nothing to forecast yet</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          Add the account you spend from and the bills that hit it, and this becomes your balance
          forecast.
        </p>
        <NuxtLink
          to="/accounts"
          class="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
        >
          Add an account<span aria-hidden="true"> →</span>
        </NuxtLink>
      </div>
    </Card>

    <div v-else class="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-5">
      <BalanceForecastCard
        :days="projection.days"
        :series="series"
        :combined="combined"
        :occurrences-by-day="occurrencesByDay"
        :legend="legend"
        :cushion="safetyCushion"
        :today-index="todayIndex"
        :lowest="verdict.lowest"
        :status="verdict.status"
        :horizon-days="horizonDays"
        :density="density"
        :density-open="densityOpen"
        :loading="loading"
        :what-if="whatIf"
        :desktop="isDesktop"
        @update:horizon-days="(value) => (horizonDays = value)"
        @update:density="(value) => (density = value)"
        @update:density-open="(value) => (densityOpen = value)"
        @update:account-checked="setAccountChecked"
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
