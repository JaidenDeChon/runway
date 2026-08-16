<script setup lang="ts">
/**
 * One scheduled event, in the Upcoming list and in the day editor's item list.
 *
 * A real `<button>` for the same reason `AccountRow` is one: the whole row is
 * the target. Income is tinted, but the minus sign on a bill is what actually
 * distinguishes the two — colour is the second telling, never the only one —
 * and the `label` gives screen readers the direction the tint conveys visually.
 */
import { ChevronRight } from '@lucide/vue'
import AccountSwatch from '@/components/AccountSwatch.vue'
import MoneyText from '@/components/MoneyText.vue'
import { formatDateShort } from '@/lib/format'
import type { IsoDate } from '~~/domain/dates'
import type { Occurrence } from '~~/domain/projection'
import type { AccountColor } from '~~/domain/types'

const props = withDefaults(
  defineProps<{
    occurrence: Occurrence
    accountName: string
    accountColor: AccountColor
    /** Hidden inside the day editor, where every row shares one date. */
    showDate?: boolean
    today?: IsoDate
  }>(),
  { showDate: true },
)

defineEmits<{ select: [] }>()
</script>

<template>
  <button
    type="button"
    class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:px-5"
    @click="$emit('select')"
  >
    <span v-if="props.showDate" class="w-16 shrink-0 text-xs text-muted-foreground lg:w-24">
      {{ formatDateShort(props.occurrence.date) }}
      <span v-if="props.today === props.occurrence.date"> · Today</span>
    </span>

    <span class="min-w-0 flex-1">
      <span class="block truncate font-medium">{{ props.occurrence.label }}</span>
      <span class="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <AccountSwatch :color="props.accountColor" size="sm" />
        <span class="truncate">{{ props.accountName }}</span>
      </span>
    </span>

    <MoneyText
      :amount="props.occurrence.amount"
      :colored="props.occurrence.amount > 0"
      :label="props.occurrence.label"
    />
    <ChevronRight aria-hidden="true" class="size-4 shrink-0 text-muted-foreground" />
  </button>
</template>
