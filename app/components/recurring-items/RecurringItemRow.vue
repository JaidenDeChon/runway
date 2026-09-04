<script setup lang="ts">
/**
 * One recurring item in the list.
 *
 * A real <button>, mirroring `AccountRow`: the whole row is the tappable
 * target, so it has to be reachable by keyboard and announce itself. The
 * chevron is decoration.
 *
 * `nextDate` is a prop, not read from `item.nextOccurrence` — that field maps
 * to `anchor_date`, the cadence's *phase*, and lies about "next" once the
 * anchor has passed (see `docs/database/schema.md`'s mapping table). The page
 * computes the true next occurrence with `nextOccurrenceOnOrAfter` and passes
 * it down, because a row performs no date arithmetic of its own (CLAUDE.md).
 * `null` means the rule has ended — `endsOn` has passed — and renders
 * "Ended" instead of a date.
 */

import { ChevronRight } from '@lucide/vue'
import { computed } from 'vue'
import AccountSwatch from '@/components/AccountSwatch.vue'
import MoneyText from '@/components/MoneyText.vue'
import { Badge } from '@/components/ui/badge'
import { formatCadence, formatDateShort } from '@/lib/format'
import type { IsoDate } from '~~/domain/dates'
import { signedAmount } from '~~/domain/projection'
import type { Account, RecurringItem } from '~~/domain/types'

const props = defineProps<{
  item: RecurringItem
  account: Account | undefined
  nextDate: IsoDate | null
}>()
defineEmits<{ select: [] }>()

const amount = computed(() => signedAmount(props.item))

const isPredicted = computed(
  () => props.item.kind === 'income' && props.item.amountSource === 'predicted',
)
const isVariableBill = computed(() => props.item.kind === 'bill' && props.item.isVariable)
const hasEnded = computed(() => props.nextDate === null)

const metaLine = computed(() => {
  const cadenceAndAccount = `${formatCadence(props.item.cadence)} · ${props.account?.name ?? 'Unknown account'}`
  return hasEnded.value
    ? `${cadenceAndAccount} · Ended`
    : `${cadenceAndAccount} · next ${formatDateShort(props.nextDate as IsoDate)}`
})
</script>

<template>
  <button
    type="button"
    class="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:px-5 lg:py-4"
    :aria-label="hasEnded ? `Edit ${props.item.name}, ended` : `Edit ${props.item.name}`"
    @click="$emit('select')"
  >
    <AccountSwatch v-if="props.account" :color="props.account.color" />
    <span v-else aria-hidden="true" class="inline-block size-2.5 shrink-0 rounded-full bg-muted-foreground" />

    <span class="min-w-0 flex-1">
      <span class="block truncate font-medium">{{ props.item.name }}</span>
      <span class="mt-0.5 block text-xs text-muted-foreground">{{ metaLine }}</span>
    </span>

    <span class="flex items-center gap-2">
      <span class="flex flex-col items-end gap-1">
        <!-- Only income is tinted: the design keeps a bill's minus sign in
             the foreground colour, reserving `--chart-positive` for gains. -->
        <MoneyText
          :amount="amount"
          signed
          :colored="props.item.kind === 'income'"
          :label="props.item.name"
        />
        <Badge v-if="isPredicted" class="border-transparent bg-accent text-muted-foreground" aria-label="Predicted from deposit history">
          Predicted
        </Badge>
        <Badge v-else-if="isVariableBill" class="border-transparent bg-accent text-muted-foreground" aria-label="Estimated amount">
          Est.
        </Badge>
      </span>
      <ChevronRight aria-hidden="true" class="size-4 shrink-0 text-muted-foreground" />
    </span>
  </button>
</template>
