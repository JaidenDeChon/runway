<script setup lang="ts">
/**
 * The day editor — a Sheet on mobile, a Dialog on desktop, via `ResponsiveEditor`.
 *
 * Two views in one surface: the day's items, and the form for editing one of
 * them. The design switches the title between them rather than nesting a second
 * overlay, so this holds a single `editing` reference and swaps the body.
 *
 * It also shows the day's running balances, which the design does not. On a
 * touch device the tooltip does not exist, and the balances were only ever
 * available on hover; putting them here is what stops that information from
 * being pointer-exclusive.
 *
 * What-if is owned by the parent, not by this component: the switch previews
 * against the same projection the chart draws, so the state has to live where
 * both can see it.
 */
import { computed, reactive, ref, watch } from 'vue'
import OccurrenceRow from '@/components/dashboard/OccurrenceRow.vue'
import MoneyInput from '@/components/MoneyInput.vue'
import MoneyText from '@/components/MoneyText.vue'
import ResponsiveEditor from '@/components/ResponsiveEditor.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { formatDateLong } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { IsoDate } from '~~/domain/dates'
import type { MinorUnits } from '~~/domain/money'
import type { OccurrenceOverride, OverrideScope } from '~~/domain/overrides'
import type { Occurrence } from '~~/domain/projection'
import type { Account } from '~~/domain/types'

const props = defineProps<{
  open: boolean
  date: IsoDate | null
  occurrences: readonly Occurrence[]
  /** Every visible series' balance on this day, in legend order. */
  balances: readonly { key: string; name: string; balance: MinorUnits }[]
  accountsById: ReadonlyMap<string, Account>
  whatIf: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:whatIf': [value: boolean]
  save: [override: OccurrenceOverride]
}>()

/** Bills are negative deltas, so the amount field has to accept them. */
const MIN_AMOUNT: MinorUnits = -99_999_999

const editing = ref<Occurrence | null>(null)

const form = reactive({
  amount: 0 as MinorUnits,
  date: '' as IsoDate,
  scope: 'once' as OverrideScope,
})

// Reopening on another day must not inherit the previous day's half-filled form.
watch(
  () => [props.open, props.date] as const,
  () => {
    editing.value = null
  },
)

function startEdit(occurrence: Occurrence): void {
  editing.value = occurrence
  form.amount = occurrence.amount
  form.date = occurrence.date
  form.scope = 'once'
}

function setScope(value: unknown): void {
  if (value === 'once' || value === 'future') form.scope = value
}

function onSave(): void {
  const occurrence = editing.value
  if (!occurrence) return
  const retimed = form.scope === 'once' && form.date !== occurrence.date
  emit('save', {
    itemId: occurrence.itemId,
    date: occurrence.date,
    scope: form.scope,
    amount: form.amount,
    ...(retimed ? { newDate: form.date } : {}),
  })
  editing.value = null
}

const title = computed(() => (editing.value ? 'Edit occurrence' : 'Day detail'))
const subtitle = computed(() => (props.date ? formatDateLong(props.date) : ''))
</script>

<template>
  <ResponsiveEditor
    :open="props.open"
    :title="title"
    :description="subtitle"
    @update:open="(value) => emit('update:open', value)"
  >
    <div class="flex flex-col gap-4">
      <!-- --chart-5 is the what-if token everywhere on this screen; dark text
           on it in both themes because the ramp lightens for dark surfaces. -->
      <p
        v-if="props.whatIf"
        class="flex items-center gap-2 rounded-md border border-dashed border-chart-5 bg-chart-5/10 px-3 py-2 text-sm font-medium text-chart-5"
      >
        <span aria-hidden="true">◑</span>
        What-if — changes here won't be saved
      </p>

      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <p id="what-if-label" class="text-sm font-medium">What-if mode</p>
          <p class="mt-0.5 text-xs text-muted-foreground">
            Try changes and watch the chart react, without saving
          </p>
        </div>
        <Switch
          :model-value="props.whatIf"
          aria-labelledby="what-if-label"
          :class="cn('mt-1 shrink-0', props.whatIf && 'data-checked:bg-chart-5')"
          @update:model-value="(value) => emit('update:whatIf', value === true)"
        />
      </div>

      <Separator />

      <template v-if="!editing">
        <dl v-if="props.balances.length > 0" class="flex flex-col gap-1">
          <div v-for="entry in props.balances" :key="entry.key" class="flex items-center gap-2">
            <dt class="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {{ entry.name }} balance
            </dt>
            <dd><MoneyText :amount="entry.balance" size="sm" /></dd>
          </div>
        </dl>

        <p v-if="props.occurrences.length === 0" class="text-sm text-muted-foreground">
          No scheduled bills or income land on this day.
        </p>

        <div v-else class="-mx-4 divide-y border-y lg:-mx-6">
          <OccurrenceRow
            v-for="occurrence in props.occurrences"
            :key="occurrence.id"
            :occurrence="occurrence"
            :account-name="props.accountsById.get(occurrence.accountId)?.name ?? 'Unknown account'"
            :account-color="props.accountsById.get(occurrence.accountId)?.color ?? 'chart-3'"
            :show-date="false"
            @select="startEdit(occurrence)"
          />
        </div>

        <Button class="w-full" @click="emit('update:open', false)">Done</Button>
      </template>

      <form v-else class="flex flex-col gap-4" @submit.prevent="onSave">
        <p class="text-sm font-medium">{{ editing?.label }}</p>

        <div class="grid grid-cols-2 gap-3">
          <div class="flex flex-col gap-2">
            <Label for="occurrence-amount">Amount</Label>
            <!-- Signed: a bill is stored as a negative delta, and hiding that
                 behind a magnitude field would make "is this in or out?"
                 unanswerable from the form. -->
            <MoneyInput
              id="occurrence-amount"
              v-model="form.amount"
              :min="MIN_AMOUNT"
              aria-label="Amount"
            />
          </div>
          <div class="flex flex-col gap-2">
            <Label for="occurrence-date">Date</Label>
            <Input
              id="occurrence-date"
              v-model="form.date"
              type="date"
              class="font-mono"
              :disabled="form.scope === 'future'"
            />
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <Label id="occurrence-scope-label">Applies to</Label>
          <ToggleGroup
            :model-value="form.scope"
            type="single"
            aria-labelledby="occurrence-scope-label"
            class="w-full rounded-lg bg-accent p-0.5"
            @update:model-value="setScope"
          >
            <ToggleGroupItem
              value="once"
              class="h-11 flex-1 data-[state=on]:bg-card lg:h-9"
            >
              This occurrence only
            </ToggleGroupItem>
            <ToggleGroupItem
              value="future"
              class="h-11 flex-1 data-[state=on]:bg-card lg:h-9"
            >
              Apply to all future
            </ToggleGroupItem>
          </ToggleGroup>
          <p v-if="form.scope === 'future'" class="text-xs text-muted-foreground">
            Rewrites the amount on every occurrence from this date onward. The date is left as it is.
          </p>
        </div>

        <div class="flex gap-2">
          <Button type="button" variant="outline" class="flex-1" @click="editing = null">
            Cancel
          </Button>
          <Button
            type="submit"
            :class="
              cn('flex-1', props.whatIf && 'bg-chart-5 text-foreground hover:bg-chart-5/90 dark:text-background')
            "
          >
            {{ props.whatIf ? 'Preview change' : 'Save change' }}
          </Button>
        </div>
      </form>
    </div>
  </ResponsiveEditor>
</template>
