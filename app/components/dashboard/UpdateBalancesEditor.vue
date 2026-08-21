<script setup lang="ts">
/**
 * Bring every account's balance up to the same day.
 *
 * Deliberately all accounts rather than only the stale ones. A reading is a
 * statement about a moment, and confirming the fresh account's number costs one
 * glance while re-typing only the stale one leaves the user asserting that a
 * balance they never checked is still true. Prefilled with what is on file, so
 * "still right" is the default and a confirm is one tap.
 *
 * It emits readings — `{ accountId, balance }` and the day they were taken —
 * rather than mutating accounts. That is the same shape an automatic balance
 * refresh will produce, and `domain/accounts`'s `applyBalanceReadings` is the
 * one function that turns either into accounts. A bank connection becomes a
 * different caller, not a second code path.
 */
import { computed, ref, watch } from 'vue'
import MoneyInput from '@/components/MoneyInput.vue'
import ResponsiveEditor from '@/components/ResponsiveEditor.vue'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { formatDateLong } from '@/lib/format'
import type { BalanceReading } from '~~/domain/accounts'
import type { IsoDate } from '~~/domain/dates'
import type { MinorUnits } from '~~/domain/money'
import type { Account } from '~~/domain/types'

const props = defineProps<{
  open: boolean
  accounts: readonly Account[]
  /** The day the readings are taken on — the user's today. */
  today: IsoDate
  /** The most recent reading on file, for the "already up to date" hint. */
  newestOnFile: IsoDate | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  save: [readings: BalanceReading[]]
}>()

interface DraftRow {
  readonly accountId: string
  readonly name: string
  readonly lastReadOn: IsoDate
  readonly isCurrent: boolean
  balance: MinorUnits
}

/**
 * One editable row per account, rebuilt whenever the editor opens.
 *
 * A list rather than a record keyed by id: `v-model` on a row's own field is
 * typed, where `v-model` into a record is `number | undefined` at every use and
 * has to be defaulted away — which would silently turn a cleared field into
 * whatever was on file.
 */
const draft = ref<DraftRow[]>([])

watch(
  () => [props.open, props.accounts] as const,
  ([open]) => {
    if (!open) return
    draft.value = props.accounts.map((account) => ({
      accountId: account.id,
      name: account.name,
      lastReadOn: account.balanceAsOf,
      isCurrent: props.newestOnFile !== null && account.balanceAsOf === props.newestOnFile,
      balance: account.balance,
    }))
  },
  { immediate: true, deep: true },
)

const todayLabel = computed(() => formatDateLong(props.today))

function save(): void {
  emit(
    'save',
    draft.value.map((row) => ({ accountId: row.accountId, balance: row.balance })),
  )
  emit('update:open', false)
}
</script>

<template>
  <ResponsiveEditor
    :open="props.open"
    title="Update balances"
    :description="`Confirm what each account holds and we'll record all of them as of ${todayLabel}.`"
    @update:open="emit('update:open', $event)"
  >
    <form class="grid gap-4" @submit.prevent="save">
      <div v-for="row in draft" :key="row.accountId" class="grid gap-1.5">
        <Label :for="`balance-${row.accountId}`" class="flex flex-wrap items-baseline gap-x-2">
          <span>{{ row.name }}</span>
          <span class="text-xs font-normal text-muted-foreground">
            <template v-if="row.isCurrent">up to date</template>
            <template v-else>last read {{ formatDateLong(row.lastReadOn) }}</template>
          </span>
        </Label>
        <MoneyInput
          :id="`balance-${row.accountId}`"
          v-model="row.balance"
          :min="Number.NEGATIVE_INFINITY"
          :aria-label="`${row.name} balance in dollars`"
        />
      </div>

      <p class="text-xs text-muted-foreground">
        Every account is recorded as of {{ todayLabel }}, including the ones you leave alone —
        that is what makes the forecast agree with itself.
      </p>

      <div class="flex justify-end gap-2">
        <Button type="button" variant="ghost" @click="emit('update:open', false)">Cancel</Button>
        <Button type="submit">Save balances</Button>
      </div>
    </form>
  </ResponsiveEditor>
</template>
