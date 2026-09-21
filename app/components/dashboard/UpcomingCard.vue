<script setup lang="ts">
/**
 * Everything landing on the accounts between today and the end of the horizon.
 *
 * This card is also most of the chart's text equivalent, which is why it is a
 * list of real controls rather than the `Table` the design's component tag
 * names: every row opens its day, and a `<table>` of interactive rows
 * announces as data rather than as controls.
 *
 * Each row's amount is now a field — see `OccurrenceAmountRow.vue` for what
 * the three buttons do and why an editable row is a different element tree
 * rather than a prop on `OccurrenceRow`. That is a deviation from
 * `docs/design/dashboard/spec.md`, which has this list read-only and puts
 * every edit behind the day editor; it is raised in the PR rather than
 * resolved quietly. The day editor is unchanged and still owns everything a
 * row cannot express — moving an occurrence to another date, reading the
 * running balances, the full apply-to-future consequence sentence.
 *
 * The 14-row cap is the design's. The line that says the list was truncated is
 * not — see the note in the page.
 */
import { computed } from 'vue'
import OccurrenceAmountRow from '@/components/dashboard/OccurrenceAmountRow.vue'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import type { OccurrenceEdit, OccurrenceRevert } from '@/lib/occurrence-editor'
import { occurrenceKey } from '@/lib/occurrence-editor'
import type { IsoDate } from '~~/domain/dates'
import type { Occurrence } from '~~/domain/projection'
import type { Account, RecurringItem } from '~~/domain/types'

const MAX_ROWS = 14

const props = defineProps<{
  occurrences: readonly Occurrence[]
  accountsById: ReadonlyMap<string, Account>
  /** Looked up only to answer "does this occurrence still have a rule to split?" */
  recurringItemsById: ReadonlyMap<string, RecurringItem>
  horizonDays: number
  today: IsoDate
  whatIf: boolean
  /** Which occurrences the what-if session is previewing, keyed by `occurrenceKey`. */
  previewedKeys: ReadonlySet<string>
  /** The row whose write is in flight, keyed the same way. */
  pendingKey: string | null
  /** The row whose last write failed, and what to say about it. */
  failedKey: string | null
  error: string | null
}>()

const emit = defineEmits<{
  selectDay: [date: IsoDate]
  update: [edit: OccurrenceEdit]
  reset: [target: OccurrenceRevert]
}>()

const visible = computed(() => props.occurrences.slice(0, MAX_ROWS))
const hidden = computed(() => Math.max(props.occurrences.length - MAX_ROWS, 0))

/**
 * The row identity, which is `occurrences`' own natural key rather than
 * `Occurrence.id`.
 *
 * An override rewrites the id, so keying the list on it would unmount and
 * remount a row the instant its amount changed — taking the caret, the focus
 * ring and the revealed buttons with it, every single edit.
 */
function keyFor(occurrence: Occurrence): string {
  return occurrenceKey(occurrence.itemId, occurrence.projectedDate)
}
</script>

<template>
  <Card class="gap-0 py-0">
    <div class="px-4 pt-4 pb-3 lg:px-5 lg:pt-5">
      <h2 class="text-base font-medium">Upcoming</h2>
      <p class="text-sm text-muted-foreground">
        Everything hitting your accounts through {{ props.horizonDays }} days
      </p>
      <!-- The bar says the mode is on; this says what it means *here*, where
           the buttons are, because a field that writes and a field that
           previews look identical. -->
      <p v-if="props.whatIf" class="mt-1 text-sm text-chart-5">
        <span aria-hidden="true">◑</span>
        Amounts you change here are previewed, not saved.
      </p>
    </div>
    <Separator />

    <p v-if="visible.length === 0" class="px-4 py-6 text-sm text-muted-foreground lg:px-5">
      Nothing is scheduled in this window.
    </p>

    <div
      v-for="(occurrence, index) in visible"
      :key="keyFor(occurrence)"
      :class="index > 0 ? 'border-t' : ''"
    >
      <OccurrenceAmountRow
        :occurrence="occurrence"
        :account-name="props.accountsById.get(occurrence.accountId)?.name ?? 'Unknown account'"
        :account-color="props.accountsById.get(occurrence.accountId)?.color ?? 'chart-3'"
        :today="props.today"
        :what-if="props.whatIf"
        :previewed="props.previewedKeys.has(keyFor(occurrence))"
        :can-update-all="props.recurringItemsById.has(occurrence.itemId)"
        :pending="props.pendingKey === keyFor(occurrence)"
        :error="props.failedKey === keyFor(occurrence) ? props.error : null"
        @select="emit('selectDay', occurrence.date)"
        @update="(edit) => emit('update', edit)"
        @reset="emit('reset', { itemId: occurrence.itemId, date: occurrence.projectedDate })"
      />
    </div>

    <p v-if="hidden > 0" class="border-t px-4 py-3 text-xs text-muted-foreground lg:px-5">
      {{ hidden }} more in this window — the chart shows all of them.
    </p>
    <div v-else class="pb-1" />
  </Card>
</template>
