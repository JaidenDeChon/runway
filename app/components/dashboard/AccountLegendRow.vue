<script setup lang="ts">
/**
 * One account in the chart legend: a real Checkbox, its swatch, its name, and
 * its balance at the *end* of the visible window — not today's balance.
 *
 * The export drew the checkbox as a `<span>` inside a `<label>`, so it was
 * neither focusable nor announced. Two further departures, both required rather
 * than chosen: the last selected account's control is `disabled` instead of
 * silently rejecting the click, and the trailing balance is wired through
 * `aria-describedby` so it is part of what the control announces.
 */
import { computed } from 'vue'
import AccountSwatch from '@/components/AccountSwatch.vue'
import MoneyText from '@/components/MoneyText.vue'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import type { MinorUnits } from '~~/domain/money'
import type { AccountColor } from '~~/domain/types'

const props = defineProps<{
  accountId: string
  name: string
  color: AccountColor
  endingBalance: MinorUnits
  checked: boolean
  /** True for the last selected account: deselecting it would empty the chart. */
  disabled: boolean
}>()

const emit = defineEmits<{ 'update:checked': [value: boolean] }>()

const inputId = computed(() => `legend-${props.accountId}`)
const balanceId = computed(() => `legend-balance-${props.accountId}`)
</script>

<template>
  <div class="flex min-h-11 items-center gap-2">
    <Checkbox
      :id="inputId"
      :model-value="props.checked"
      :disabled="props.disabled"
      :aria-describedby="balanceId"
      @update:model-value="(value) => emit('update:checked', value === true)"
    />
    <AccountSwatch :color="props.color" />
    <Label :for="inputId" class="cursor-pointer text-sm font-normal">
      <span class="sr-only">Show </span>{{ props.name }}<span class="sr-only"> on the chart</span>
    </Label>
    <MoneyText :id="balanceId" :amount="props.endingBalance" size="sm" class="ml-3" />
  </div>
</template>
