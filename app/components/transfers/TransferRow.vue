<script setup lang="ts">
/**
 * One row in the "Recent transfers" list.
 *
 * Static by design — no tap target, no edit, no delete — unlike the Accounts
 * and Recurring items rows, which do open an editor. See spec Open questions
 * #4: a mistaken transfer currently has no way to be corrected.
 */
import MoneyText from '@/components/MoneyText.vue'
import TransferLegs from '@/components/transfers/TransferLegs.vue'
import { Badge } from '@/components/ui/badge'
import { formatDateShort } from '@/lib/format'
import type { Account, Transfer } from '~~/domain/types'

const props = defineProps<{
  transfer: Transfer
  fromAccount: Account | null
  toAccount: Account | null
}>()
</script>

<template>
  <div class="flex items-center gap-3 px-4 py-3.5 lg:px-5 lg:py-4">
    <TransferLegs
      :from-color="props.fromAccount?.color ?? 'chart-2'"
      :to-color="props.toAccount?.color ?? 'chart-2'"
    />

    <span class="min-w-0 flex-1">
      <span class="block truncate font-medium">
        {{ props.fromAccount?.name ?? 'Unknown account' }} to {{ props.toAccount?.name ?? 'Unknown account' }}
      </span>
      <span class="mt-0.5 block text-xs text-muted-foreground">
        {{ formatDateShort(props.transfer.date) }}
      </span>
    </span>

    <span class="flex shrink-0 flex-col items-end gap-1.5">
      <MoneyText :amount="props.transfer.amount" />
      <Badge class="bg-accent text-muted-foreground">Transfer</Badge>
    </span>
  </div>
</template>
