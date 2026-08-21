<script setup lang="ts">
/**
 * Says so when the accounts' balances were last read on different days.
 *
 * This is a warning about the *inputs*, not about the money, and it sits above
 * the forecast because everything below it is derived from readings that do not
 * describe one moment. A balance is true as of its own day and already contains
 * everything up to that day, so a chart built from a reading taken today and
 * one taken three weeks ago is quietly adding a stale number to a fresh one —
 * and recording a transfer between the two moves the combined line, which looks
 * exactly like the app losing money.
 *
 * Amber rather than destructive: nothing is broken and nothing was lost. The
 * forecast is simply less trustworthy than it looks, and one action fixes it.
 * `--chart-warning` is the token the "Tight" verdict already uses for exactly
 * this register — a caution the user should act on, not an error.
 *
 * Purely presentational. Every figure here — which accounts, how far behind —
 * comes from `domain/accounts`'s `balanceReadings`.
 */
import { TriangleAlert } from '@lucide/vue'
import { computed } from 'vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { formatDateLong } from '@/lib/format'
import type { BalanceReadings } from '~~/domain/accounts'
import type { Account } from '~~/domain/types'

const props = defineProps<{
  readings: BalanceReadings
  accountsById: Map<string, Account>
}>()

defineEmits<{ update: [] }>()

const names = computed(() =>
  props.readings.stale.map(
    (entry) => props.accountsById.get(entry.accountId)?.name ?? 'An account',
  ),
)

/** "Savings", "Savings and Travel", "Savings, Travel and Buffer". */
const nameList = computed(() => {
  const list = names.value
  if (list.length <= 1) return list[0] ?? 'One account'
  return `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`
})

const behind = computed(() => {
  const worst = props.readings.stale[0]?.daysBehind ?? 0
  return worst === 1 ? 'a day' : `${worst} days`
})
</script>

<template>
  <Alert class="border-chart-warning/40 bg-chart-warning/8 text-foreground">
    <TriangleAlert aria-hidden="true" class="text-chart-warning" />
    <AlertTitle class="font-medium">Some balances are older than others</AlertTitle>
    <AlertDescription class="text-muted-foreground">
      <p>
        {{ nameList }}
        {{ names.length === 1 ? 'was' : 'were' }} last updated {{ behind }} before your other
        accounts, so this forecast is mixing a fresh balance with a stale one.
        <template v-if="props.readings.newest">
          Bringing everything up to {{ formatDateLong(props.readings.newest) }} or later makes it
          agree with itself.
        </template>
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="mt-2.5 min-h-11 sm:min-h-9"
        @click="$emit('update')"
      >
        Update balances
      </Button>
    </AlertDescription>
  </Alert>
</template>
