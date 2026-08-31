<script setup lang="ts">
/**
 * Step 1 — the account half of onboarding.
 *
 * Deliberately narrower than `AccountEditor`: no discretionary-source
 * checkbox (onboarding's one account always holds it — see `first-run.vue`)
 * and no delete. Validity is computed here from `name`, same as
 * `AccountEditor.isValid`, so the parent never has to duplicate the trim
 * guard — it only re-checks it in the `continue` handler, per the spec.
 */
import { computed } from 'vue'
import AccountColorPicker from '@/components/AccountColorPicker.vue'
import MoneyInput from '@/components/MoneyInput.vue'
import { Button } from '@/components/ui/button'
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { IsoDate } from '~~/domain/dates'
import type { MinorUnits } from '~~/domain/money'
import type { AccountColor } from '~~/domain/types'

const props = defineProps<{
  name: string
  balance: MinorUnits
  balanceAsOf: IsoDate
  color: AccountColor
  /** True while the parent's save handler is awaiting the write. */
  saving?: boolean
  /** Set by the parent on a failed save; rendered inline. */
  error?: string | null
}>()

const emit = defineEmits<{
  'update:name': [value: string]
  'update:balance': [value: MinorUnits]
  'update:balanceAsOf': [value: IsoDate]
  'update:color': [value: AccountColor]
  continue: []
}>()

const isValid = computed(() => props.name.trim().length > 0)
const canContinue = computed(() => isValid.value && !props.saving)

function onContinue(): void {
  // The gate exists in two places: disabling Continue, and here.
  if (!canContinue.value) return
  emit('continue')
}
</script>

<template>
  <form class="flex flex-col gap-4" @submit.prevent="onContinue">
    <CardHeader class="gap-1">
      <p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Step 1 of 2</p>
      <CardTitle class="text-lg">Add your first account</CardTitle>
      <CardDescription>Runway needs one account balance to start from.</CardDescription>
    </CardHeader>

    <CardContent class="flex flex-col gap-4">
      <div class="flex flex-col gap-2">
        <Label for="onboarding-account-name">Name</Label>
        <Input
          id="onboarding-account-name"
          :model-value="props.name"
          placeholder="e.g. Checking"
          autocomplete="off"
          @update:model-value="(value) => emit('update:name', String(value))"
        />
      </div>

      <div class="flex flex-col gap-2">
        <Label>Line color</Label>
        <AccountColorPicker
          :model-value="props.color"
          name="onboarding-account-color"
          @update:model-value="(value) => emit('update:color', value)"
        />
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="flex flex-col gap-2">
          <Label for="onboarding-account-balance">Balance</Label>
          <MoneyInput
            id="onboarding-account-balance"
            :model-value="props.balance"
            aria-label="Balance"
            @update:model-value="(value) => emit('update:balance', value)"
          />
        </div>
        <div class="flex flex-col gap-2">
          <Label for="onboarding-account-as-of">As of</Label>
          <Input
            id="onboarding-account-as-of"
            type="date"
            class="font-mono"
            :model-value="props.balanceAsOf"
            @update:model-value="(value) => emit('update:balanceAsOf', String(value))"
          />
        </div>
      </div>

      <p v-if="props.error" role="alert" class="text-sm text-destructive">{{ props.error }}</p>

      <Button type="submit" class="w-full" :disabled="!canContinue" :aria-describedby="isValid ? undefined : 'onboarding-account-continue-help'">
        Continue
      </Button>
      <p v-if="!isValid" id="onboarding-account-continue-help" class="-mt-2 text-xs text-muted-foreground">
        Name your account to continue.
      </p>
    </CardContent>
  </form>
</template>
