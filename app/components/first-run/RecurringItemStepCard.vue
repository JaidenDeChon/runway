<script setup lang="ts">
/**
 * Step 2 — the recurring-item half of onboarding.
 *
 * Always a fixed amount: onboarding never offers the "predicted from
 * deposits" source the recurring-items screen has, per the spec's step-2
 * notes. The Bill/Income switch is a `ToggleGroup` rather than `Tabs` — the
 * export tags it `Tabs` but styles a segmented control, and the spec asks for
 * whichever control the recurring-items screen uses for the same choice; that
 * screen uses a `ToggleGroup` too. Its look comes from `SEGMENTED_*`, shared
 * with every other segmented control in the app.
 */
import { computed } from 'vue'
import MoneyInput from '@/components/MoneyInput.vue'
import { Button } from '@/components/ui/button'
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { formatCadence } from '@/lib/format'
import { SEGMENTED_SEGMENT, SEGMENTED_TRACK } from '@/lib/segmented-control'
import { cn } from '@/lib/utils'
import type { IsoDate } from '~~/domain/dates'
import type { MinorUnits } from '~~/domain/money'
import type { Cadence, RecurringKind } from '~~/domain/types'
import { CADENCES } from '~~/domain/types'

const props = defineProps<{
  name: string
  kind: RecurringKind
  amount: MinorUnits
  cadence: Cadence
  nextOccurrence: IsoDate
}>()

const emit = defineEmits<{
  'update:name': [value: string]
  'update:kind': [value: RecurringKind]
  'update:amount': [value: MinorUnits]
  'update:cadence': [value: Cadence]
  'update:nextOccurrence': [value: IsoDate]
  back: []
  build: []
}>()

const isValid = computed(() => props.name.trim().length > 0)

const namePlaceholder = computed(() => (props.kind === 'income' ? 'e.g. Paycheck' : 'e.g. Rent'))

function onKindChange(value: unknown): void {
  // A single-select ToggleGroup deselects on a repeat click by default; the
  // switch always has exactly one side chosen, so an empty value is ignored.
  if (typeof value !== 'string' || value === '') return
  emit('update:kind', value as RecurringKind)
}

function onBuild(): void {
  if (!isValid.value) return
  emit('build')
}
</script>

<template>
  <form class="flex flex-col gap-4" @submit.prevent="onBuild">
    <CardHeader class="gap-1">
      <p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Step 2 of 2</p>
      <CardTitle class="text-lg">Add a bill or paycheck</CardTitle>
      <CardDescription>One recurring item is enough to see your first projection.</CardDescription>
    </CardHeader>

    <CardContent class="flex flex-col gap-4">
      <ToggleGroup
        type="single"
        :model-value="props.kind"
        :class="cn(SEGMENTED_TRACK, 'w-full')"
        aria-label="Bill or income"
        @update:model-value="onKindChange"
      >
        <ToggleGroupItem value="bill" :class="cn(SEGMENTED_SEGMENT, 'h-11 flex-1 lg:h-9')">
          Bill
        </ToggleGroupItem>
        <ToggleGroupItem value="income" :class="cn(SEGMENTED_SEGMENT, 'h-11 flex-1 lg:h-9')">
          Income
        </ToggleGroupItem>
      </ToggleGroup>

      <div class="flex flex-col gap-2">
        <Label for="onboarding-item-name">Name</Label>
        <Input
          id="onboarding-item-name"
          :model-value="props.name"
          :placeholder="namePlaceholder"
          autocomplete="off"
          @update:model-value="(value) => emit('update:name', String(value))"
        />
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="flex min-w-0 flex-col gap-2">
          <Label for="onboarding-item-amount">Amount</Label>
          <MoneyInput
            id="onboarding-item-amount"
            :model-value="props.amount"
            aria-label="Amount"
            @update:model-value="(value) => emit('update:amount', value)"
          />
        </div>
        <div class="flex min-w-0 flex-col gap-2">
          <Label for="onboarding-item-cadence">Cadence</Label>
          <Select :model-value="props.cadence" @update:model-value="(value) => emit('update:cadence', value as Cadence)">
            <SelectTrigger id="onboarding-item-cadence" class="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="option in CADENCES" :key="option" :value="option">
                {{ formatCadence(option) }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <Label for="onboarding-item-next-occurrence">Next occurrence</Label>
        <Input
          id="onboarding-item-next-occurrence"
          type="date"
          class="font-mono"
          :model-value="props.nextOccurrence"
          @update:model-value="(value) => emit('update:nextOccurrence', String(value))"
        />
      </div>

      <div class="flex gap-2 pt-1">
        <Button type="button" variant="outline" @click="emit('back')">Back</Button>
        <Button
          type="submit"
          class="flex-1"
          :disabled="!isValid"
          :aria-describedby="isValid ? undefined : 'onboarding-item-build-help'"
        >
          Build my runway
        </Button>
      </div>
      <p v-if="!isValid" id="onboarding-item-build-help" class="text-xs text-muted-foreground">
        Name your bill or paycheck to continue.
      </p>
    </CardContent>
  </form>
</template>
