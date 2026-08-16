<script setup lang="ts">
/**
 * Everything landing on the accounts between today and the end of the horizon.
 *
 * This card is also most of the chart's text equivalent, which is why it is a
 * list of real buttons rather than the `Table` the design's component tag names:
 * every row opens its day, and a `<table>` of interactive rows announces as data
 * rather than as controls.
 *
 * The 14-row cap is the design's. The line that says the list was truncated is
 * not — see the note in the page.
 */
import { computed } from 'vue'
import OccurrenceRow from '@/components/dashboard/OccurrenceRow.vue'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import type { IsoDate } from '~~/domain/dates'
import type { Occurrence } from '~~/domain/projection'
import type { Account } from '~~/domain/types'

const MAX_ROWS = 14

const props = defineProps<{
  occurrences: readonly Occurrence[]
  accountsById: ReadonlyMap<string, Account>
  horizonDays: number
  today: IsoDate
}>()

const emit = defineEmits<{ selectDay: [date: IsoDate] }>()

const visible = computed(() => props.occurrences.slice(0, MAX_ROWS))
const hidden = computed(() => Math.max(props.occurrences.length - MAX_ROWS, 0))
</script>

<template>
  <Card class="gap-0 py-0">
    <div class="px-4 pt-4 pb-3 lg:px-5 lg:pt-5">
      <h2 class="text-base font-medium">Upcoming</h2>
      <p class="text-sm text-muted-foreground">
        Everything hitting your accounts through {{ props.horizonDays }} days
      </p>
    </div>
    <Separator />

    <p v-if="visible.length === 0" class="px-4 py-6 text-sm text-muted-foreground lg:px-5">
      Nothing is scheduled in this window.
    </p>

    <div
      v-for="(occurrence, index) in visible"
      :key="occurrence.id"
      :class="index > 0 ? 'border-t' : ''"
    >
      <OccurrenceRow
        :occurrence="occurrence"
        :account-name="props.accountsById.get(occurrence.accountId)?.name ?? 'Unknown account'"
        :account-color="props.accountsById.get(occurrence.accountId)?.color ?? 'chart-3'"
        :today="props.today"
        @select="emit('selectDay', occurrence.date)"
      />
    </div>

    <p v-if="hidden > 0" class="border-t px-4 py-3 text-xs text-muted-foreground lg:px-5">
      {{ hidden }} more in this window — the chart shows all of them.
    </p>
    <div v-else class="pb-1" />
  </Card>
</template>
