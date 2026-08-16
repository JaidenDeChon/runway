<script setup lang="ts">
/**
 * The "New transfer" card — the only place a transfer is created.
 *
 * All the rules this form enforces (accounts must differ, amount must be
 * positive, which account `From` auto-corrects `To` to) live in
 * `domain/transfers.ts`; this component only maps `TransferProblem[]` to the
 * one message the design shows and wires the fields to it.
 */

import { ArrowRight } from '@lucide/vue'
import { computed, ref } from 'vue'
import MoneyInput from '@/components/MoneyInput.vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useRunwayData } from '@/composables/useRunwayData'
import { useToday } from '@/composables/useToday'
import type { IsoDate } from '~~/domain/dates'
import type { MinorUnits } from '~~/domain/money'
import { canSubmitTransfer, resolveCounterAccount, validateTransfer } from '~~/domain/transfers'

const { accounts, addTransfer } = useRunwayData()
const today = useToday()

const from = ref(accounts.value[0]?.id ?? '')
const to = ref(resolveCounterAccount(accounts.value, from.value) ?? from.value)
const amount = ref<MinorUnits>(0)
const date = ref<IsoDate>(today.value)

const problems = computed(() =>
  validateTransfer({ fromAccountId: from.value, toAccountId: to.value, amount: amount.value }),
)
const canSubmit = computed(() =>
  canSubmitTransfer({ fromAccountId: from.value, toAccountId: to.value, amount: amount.value }),
)
const sameAccount = computed(() => problems.value.includes('same-account'))

const ALERT_ID = 'transfer-same-account-alert'

function onFromChange(value: unknown): void {
  const id = String(value)
  from.value = id
  // Changing From never leaves the user in the warning state: if the new
  // From is the current To, To moves to make room rather than colliding.
  if (to.value === id) {
    const counter = resolveCounterAccount(accounts.value, id)
    if (counter) to.value = counter
  }
}

function onToChange(value: unknown): void {
  to.value = String(value)
}

function onDateInput(value: string | number): void {
  const next = String(value)
  // An empty value means the field was cleared, not that the date is blank —
  // the previous date is kept so the field can never become empty.
  if (next) date.value = next
}

function onSubmit(): void {
  if (!canSubmit.value) return
  addTransfer({
    fromAccountId: from.value,
    toAccountId: to.value,
    amount: amount.value,
    date: date.value,
  })
  amount.value = 0
}
</script>

<template>
  <Card class="gap-4">
    <h2 class="px-6 font-medium lg:px-7">New transfer</h2>

    <form class="flex flex-col gap-4 px-6 lg:px-7" @submit.prevent="onSubmit">
      <div class="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <div class="flex flex-col gap-2">
          <Label for="transfer-from">From</Label>
          <Select :model-value="from" @update:model-value="onFromChange">
            <SelectTrigger id="transfer-from" class="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="account in accounts" :key="account.id" :value="account.id">
                {{ account.name }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div class="flex h-9 items-center">
          <ArrowRight aria-hidden="true" class="size-4 text-muted-foreground" />
        </div>

        <div class="flex flex-col gap-2">
          <Label for="transfer-to">To</Label>
          <Select
            :model-value="to"
            @update:model-value="onToChange"
          >
            <SelectTrigger
              id="transfer-to"
              class="w-full"
              :aria-invalid="sameAccount"
              :aria-describedby="sameAccount ? ALERT_ID : undefined"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="account in accounts" :key="account.id" :value="account.id">
                {{ account.name }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <div class="flex flex-col gap-2">
          <Label for="transfer-amount">Amount</Label>
          <MoneyInput id="transfer-amount" v-model="amount" aria-label="Amount" />
        </div>
        <div class="flex flex-col gap-2">
          <Label for="transfer-date">Date</Label>
          <Input
            id="transfer-date"
            :model-value="date"
            type="date"
            class="font-mono"
            @update:model-value="onDateInput"
          />
        </div>
      </div>

      <Alert v-if="sameAccount" :id="ALERT_ID" variant="destructive" class="border-none bg-accent">
        <AlertDescription>Choose two different accounts to move money between them.</AlertDescription>
      </Alert>

      <Button
        type="submit"
        class="w-full disabled:pointer-events-auto disabled:cursor-not-allowed disabled:bg-accent disabled:text-muted-foreground disabled:opacity-100"
        :disabled="!canSubmit"
      >
        Move money
      </Button>
    </form>
  </Card>
</template>
