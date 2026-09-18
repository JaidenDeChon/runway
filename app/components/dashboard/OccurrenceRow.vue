<script setup lang="ts">
/**
 * One scheduled event, in the Upcoming list and in the day editor's item list.
 *
 * A real `<button>` for the same reason `AccountRow` is one: the whole row is
 * the target. Income is tinted, but the minus sign on a bill is what actually
 * distinguishes the two — colour is the second telling, never the only one —
 * and the `label` gives screen readers the direction the tint conveys visually.
 *
 * Issue #15: a hand-edited occurrence reads `occurrence.isOverridden` /
 * `.projectedDate` directly — no new props — and gets an `Edited` badge (real
 * text, so it is announced, not a colour-only telling) plus a "moved from"
 * line when the edit also retimed the day. Used by both the Upcoming list and
 * `DayDetailEditor`'s own item list, so both get the marking for free.
 */
import { ChevronRight } from '@lucide/vue'
import AccountSwatch from '@/components/AccountSwatch.vue'
import MoneyText from '@/components/MoneyText.vue'
import { Badge } from '@/components/ui/badge'
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
      <span class="flex items-center gap-1.5">
        <span class="truncate font-medium">{{ props.occurrence.label }}</span>
        <Badge v-if="props.occurrence.isOverridden" variant="outline" class="shrink-0">
          Edited
        </Badge>
      </span>
      <span class="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <AccountSwatch :color="props.accountColor" size="sm" />
        <span class="truncate">{{ props.accountName }}</span>
      </span>
      <span
        v-if="props.occurrence.isOverridden && props.occurrence.date !== props.occurrence.projectedDate"
        class="mt-0.5 block text-xs text-muted-foreground"
      >
        moved from {{ formatDateShort(props.occurrence.projectedDate) }}
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
