<script setup lang="ts">
/**
 * One account in the list.
 *
 * A real `<button>`, not a div with a click handler: the whole row is the
 * target, so it has to be reachable by keyboard and announce itself. The
 * chevron is decoration.
 */
import { ChevronRight } from '@lucide/vue'
import AccountSwatch from '@/components/AccountSwatch.vue'
import MoneyText from '@/components/MoneyText.vue'
import { Badge } from '@/components/ui/badge'
import { formatDateLong } from '@/lib/format'
import type { Account } from '~~/domain/types'

const props = defineProps<{ account: Account }>()
defineEmits<{ select: [] }>()
</script>

<template>
  <button
    type="button"
    class="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:px-5 lg:py-4"
    :aria-label="`Edit ${props.account.name}`"
    @click="$emit('select')"
  >
    <AccountSwatch :color="props.account.color" />

    <span class="min-w-0 flex-1">
      <span class="flex flex-wrap items-center gap-2">
        <span class="truncate font-medium">{{ props.account.name }}</span>
        <Badge v-if="props.account.isDiscretionarySource" variant="secondary">
          Discretionary source
        </Badge>
      </span>
      <span class="mt-0.5 block text-xs text-muted-foreground">
        Balance as of {{ formatDateLong(props.account.balanceAsOf) }}
      </span>
    </span>

    <MoneyText :amount="props.account.balance" />
    <ChevronRight aria-hidden="true" class="size-4 shrink-0 text-muted-foreground" />
  </button>
</template>
