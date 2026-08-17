<script setup lang="ts">
/**
 * The "ask" card: mode Tabs, then either the bill RadioGroup or a date
 * Input, then the safety-cushion row.
 *
 * All four pieces of state (mode, selected bill, selected date, cushion) are
 * owned by the page — this component only renders them and emits changes, so
 * switching tabs never loses the bill selection or the typed date.
 */
import { computed } from 'vue'
import MoneyInput from '@/components/MoneyInput.vue'
import BillOptionRow from '@/components/shortfall/BillOptionRow.vue'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup } from '@/components/ui/radio-group'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SEGMENTED_SEGMENT, SEGMENTED_TRACK } from '@/lib/segmented-control'
import { cn } from '@/lib/utils'
import type { IsoDate } from '~~/domain/dates'
import { addDays } from '~~/domain/dates'
import type { MinorUnits } from '~~/domain/money'
import type { UpcomingBill } from '~~/domain/projection'

const props = defineProps<{
  mode: 'bill' | 'date'
  selectedBillId: string | null
  selectedDate: IsoDate
  cushion: MinorUnits
  bills: readonly UpcomingBill[]
  today: IsoDate
}>()

const emit = defineEmits<{
  'update:mode': [value: 'bill' | 'date']
  'update:selectedBillId': [value: string]
  'update:selectedDate': [value: IsoDate]
  'update:cushion': [value: MinorUnits]
}>()

// Bounded per spec: the earliest answerable date is tomorrow, the furthest is
// half a year out. Calendar-day math, not money — `domain/dates` is fair game
// in a component the way `domain/money` arithmetic is not.
const minDate = computed(() => addDays(props.today, 1))
const maxDate = computed(() => addDays(props.today, 180))

function onDateInput(value: string | number): void {
  // A cleared native date input emits "". The design keeps the previous
  // target rather than letting the question go unanswerable mid-edit.
  const next = String(value)
  if (next === '') return
  emit('update:selectedDate', next)
}
</script>

<template>
  <Card>
    <CardContent class="flex flex-col gap-4">
      <Tabs
        :model-value="props.mode"
        class="w-full gap-4 lg:w-fit lg:self-center"
        @update:model-value="(value) => emit('update:mode', value as 'bill' | 'date')"
      >
        <!--
          Departure from spec.md line 166, requested: the mode tabs were specced
          to fill with `--primary`. They now use the app's shared segmented
          control treatment. This also resolves spec open question 3, which
          flagged the primary fill as a brand inconsistency between the themes.
        -->
        <TabsList :class="cn(SEGMENTED_TRACK, 'w-full lg:w-fit')">
          <TabsTrigger
            value="bill"
            :class="cn(SEGMENTED_SEGMENT, 'flex-1 lg:flex-none')"
          >
            Upcoming bill
          </TabsTrigger>
          <TabsTrigger
            value="date"
            :class="cn(SEGMENTED_SEGMENT, 'flex-1 lg:flex-none')"
          >
            Pick a date
          </TabsTrigger>
        </TabsList>

        <TabsContent value="bill">
          <RadioGroup
            aria-label="Which bill?"
            :model-value="props.selectedBillId ?? undefined"
            class="gap-1"
            @update:model-value="(value) => emit('update:selectedBillId', value as string)"
          >
            <BillOptionRow
              v-for="bill in props.bills"
              :key="bill.itemId"
              :bill="bill"
              :selected="bill.itemId === props.selectedBillId"
            />
          </RadioGroup>
          <p v-if="props.bills.length === 0" class="px-1 py-2 text-sm text-muted-foreground">
            No upcoming bills in the next few months — try picking a date instead.
          </p>
        </TabsContent>

        <TabsContent value="date">
          <div class="flex flex-col gap-2">
            <Label for="shortfall-date">Date</Label>
            <Input
              id="shortfall-date"
              type="date"
              :model-value="props.selectedDate"
              :min="minDate"
              :max="maxDate"
              class="font-mono"
              @update:model-value="onDateInput"
            />
          </div>
        </TabsContent>
      </Tabs>

      <Separator />

      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0 flex-1">
          <Label for="shortfall-cushion">Safety cushion</Label>
          <p class="mt-1 text-xs text-muted-foreground lg:whitespace-nowrap">
            The lowest balance you're comfortable letting it reach.
          </p>
        </div>
        <MoneyInput
          id="shortfall-cushion"
          :model-value="props.cushion"
          aria-label="Safety cushion"
          class="w-28 shrink-0"
          @update:model-value="(value) => emit('update:cushion', value)"
        />
      </div>
    </CardContent>
  </Card>
</template>
