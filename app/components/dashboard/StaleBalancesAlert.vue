<script setup lang="ts">
/**
 * Says so when the accounts' balances were last read on different days.
 *
 * This is a warning about the *inputs*, not about the money, and it sits inside
 * the forecast card directly above the chart it is warning about. A balance is
 * true as of its own day and already contains everything up to that day, so a
 * chart built from a reading taken today and one taken three weeks ago is
 * quietly adding a stale number to a fresh one — and recording a transfer
 * between the two moves the combined line, which looks exactly like the app
 * losing money.
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
import { formatDateShort } from '@/lib/format'
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

const isSingle = computed(() => names.value.length <= 1)

/** `"Savings"`, `"Savings" and "Travel"`, `"Savings", "Travel" and "Buffer"`. */
const nameList = computed(() => {
  const quoted = names.value.map((name) => `"${name}"`)
  if (quoted.length <= 1) return quoted[0] ?? '"One account"'
  return `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`
})

/**
 * How long the worst-off account has been behind.
 *
 * "up to" once more than one account is named, because a single figure cannot
 * be true of all of them and the worst is the one that matters.
 */
const behind = computed(() => {
  const worst = props.readings.stale[0]?.daysBehind ?? 0
  const days = worst === 1 ? 'a day' : `${worst} days`
  return isSingle.value ? days : `up to ${days}`
})
</script>

<template>
  <Alert class="border-chart-warning/40 bg-chart-warning/8 text-foreground">
    <TriangleAlert aria-hidden="true" class="text-chart-warning" />
    <AlertTitle class="font-medium">Some balances are older than others</AlertTitle>
    <AlertDescription class="text-muted-foreground">
      <p>
        Your {{ nameList }} {{ isSingle ? 'account hasn\'t' : 'accounts haven\'t' }} been updated in
        {{ behind }}.
        {{
          isSingle
            ? 'Since that account has older data than your others,'
            : 'Since those accounts have older data than your others,'
        }}
        this chart is not as accurate as it should be.
        <template v-if="props.readings.newest">
          Please bring everything up to {{ formatDateShort(props.readings.newest) }} for the most
          accuracy.
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
