<script setup lang="ts">
/**
 * The info box that replaces the Amount input when an income item's amount
 * source is "Predict from deposits".
 *
 * It also carries the "Next occurrence" field: the design moves that input
 * inside the panel in this mode, so it lives here rather than being
 * duplicated in the parent form for both amount-source states.
 */

import MoneyText from '@/components/MoneyText.vue'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { IsoDate } from '~~/domain/dates'
import type { MinorUnits } from '~~/domain/money'

const props = defineProps<{
  predicted: MinorUnits
  depositCount: number
  nextOccurrence: IsoDate
}>()
const emit = defineEmits<{ 'update:nextOccurrence': [value: IsoDate] }>()
</script>

<template>
  <div class="rounded-md bg-accent p-3">
    <p class="flex items-baseline gap-1.5">
      <MoneyText :amount="props.predicted" signed colored size="lg" label="Predicted income" />
      <span class="font-mono text-sm text-chart-positive">predicted</span>
    </p>
    <p class="mt-1 text-xs text-muted-foreground">
      Predicted from your last {{ props.depositCount }} deposit{{ props.depositCount === 1 ? '' : 's' }}.
      Runway uses this estimate until a real deposit lands.
    </p>

    <div class="mt-3 flex flex-col gap-2">
      <Label for="recurring-next-occurrence-predicted">Next occurrence</Label>
      <Input
        id="recurring-next-occurrence-predicted"
        type="date"
        class="font-mono"
        :model-value="props.nextOccurrence"
        @update:model-value="(value) => emit('update:nextOccurrence', String(value))"
      />
    </div>
  </div>
</template>
