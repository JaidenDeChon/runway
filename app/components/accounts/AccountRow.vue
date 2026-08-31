<script setup lang="ts">
/**
 * One account in the list.
 *
 * A real `<button>`, not a div with a click handler: the whole row is the
 * target, so it has to be reachable by keyboard and announce itself. The
 * chevron is decoration.
 *
 * Meta line precedence — one warning per row, never more than one:
 * 1. Archived: `Archived {date}`, the whole row muted, no warning colour —
 *    nothing is wrong, it is out of the forecast on purpose.
 * 2. Else a stale anchor (`staleDays`, absolute age against today):
 *    `· Last updated N days ago`, in the warning register.
 * 3. Else relative drift (`daysBehind`, against the household's other
 *    readings): `· N days behind`.
 * Absolute staleness beats relative drift because "this number is 40 days
 * old" is strictly more actionable than "this number is 3 days behind
 * another one", and showing both on one row reads as noise.
 */
import { ChevronRight } from '@lucide/vue'
import { computed } from 'vue'
import AccountSwatch from '@/components/AccountSwatch.vue'
import MoneyText from '@/components/MoneyText.vue'
import { Badge } from '@/components/ui/badge'
import { formatDateLong } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Account } from '~~/domain/types'

const props = defineProps<{
  account: Account
  /**
   * How far this account's reading is behind the most recent one, from
   * `domain/accounts`'s `balanceReadings`. `0` when it is current.
   */
  daysBehind?: number
  /**
   * The anchor's absolute age against today, from `domain/accounts`'s
   * `staleAnchors`. `0` when it is not stale.
   */
  staleDays?: number
}>()
defineEmits<{ select: [] }>()

const isArchived = computed(() => props.account.archivedOn !== undefined)

const metaLine = computed(() => {
  if (isArchived.value) return null // rendered directly below; it replaces the balance-as-of line entirely
  const stale = props.staleDays ?? 0
  if (stale > 0) {
    return {
      text: stale === 1 ? 'Last updated 1 day ago' : `Last updated ${stale} days ago`,
      warn: true,
    }
  }
  const behind = props.daysBehind ?? 0
  if (behind > 0) {
    return { text: behind === 1 ? '1 day behind' : `${behind} days behind`, warn: false }
  }
  return null
})
</script>

<template>
  <button
    type="button"
    class="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:px-5 lg:py-4"
    :class="cn(isArchived && 'opacity-70')"
    :aria-label="isArchived ? `View ${props.account.name}` : `Edit ${props.account.name}`"
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
        <template v-if="isArchived">
          Archived {{ formatDateLong(props.account.archivedOn!) }}
        </template>
        <template v-else>
          Balance as of {{ formatDateLong(props.account.balanceAsOf) }}
          <!-- Amber, not red: an out-of-step or aging reading makes the
               forecast less trustworthy, it does not make anything wrong.
               Same register as the dashboard's alert and the "Tight" verdict. -->
          <span v-if="metaLine" :class="metaLine.warn ? 'text-chart-warning' : ''">
            · {{ metaLine.text }}
          </span>
        </template>
      </span>
    </span>

    <MoneyText :amount="props.account.balance" />
    <ChevronRight aria-hidden="true" class="size-4 shrink-0 text-muted-foreground" />
  </button>
</template>
