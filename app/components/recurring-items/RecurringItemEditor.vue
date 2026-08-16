<script setup lang="ts">
/**
 * The recurring-item form — one body, mounted into a Sheet or a Dialog by
 * `ResponsiveEditor`. Mirrors `AccountEditor`'s shape and its two deliberate
 * deviations from the export:
 *
 * - **Save is disabled while the name is blank**, rather than the export's
 *   silent no-op.
 * - **Delete asks first.** The spec leaves this an open question ("no
 *   confirmation and no undo" vs. a confirm step); `AccountEditor` already
 *   answered it for this app, so the same inline confirm is used here rather
 *   than inventing a second answer to the same question.
 *
 * Predicted income is resolved by `useRunwayData().saveRecurringItem` at save
 * time — this form only *previews* the predicted figure, via the same
 * `resolveAmount` the store calls, so the preview and the saved value can
 * never disagree.
 */
import { computed, reactive, ref, watch } from 'vue'
import MoneyInput from '@/components/MoneyInput.vue'
import ResponsiveEditor from '@/components/ResponsiveEditor.vue'
import PredictedAmountPanel from '@/components/recurring-items/PredictedAmountPanel.vue'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useRunwayData } from '@/composables/useRunwayData'
import { useToday } from '@/composables/useToday'
import { formatCadence } from '@/lib/format'
import type { IsoDate } from '~~/domain/dates'
import type { MinorUnits } from '~~/domain/money'
import { canPredict, MIN_DEPOSITS_FOR_PREDICTION, resolveAmount } from '~~/domain/prediction'
import type { AmountSource, Cadence, RecurringItem, RecurringKind } from '~~/domain/types'
import { CADENCES } from '~~/domain/types'

const props = defineProps<{ open: boolean; item: RecurringItem | null }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const { accounts, saveRecurringItem, removeRecurringItem } = useRunwayData()
const today = useToday()

const isEditing = computed(() => props.item !== null)
const confirmingDelete = ref(false)

const form = reactive({
  type: 'bill' as RecurringKind,
  name: '',
  cadence: 'monthly' as Cadence,
  accountId: '',
  amount: 0 as MinorUnits,
  nextOccurrence: today.value as IsoDate,
  amountSource: 'fixed' as AmountSource,
  depositHistory: [] as readonly MinorUnits[],
  isVariable: false,
})

watch(
  () => [props.open, props.item] as const,
  ([open, item]) => {
    if (!open) return
    confirmingDelete.value = false
    if (item) {
      Object.assign(form, {
        type: item.kind,
        name: item.name,
        cadence: item.cadence,
        accountId: item.accountId,
        amount: item.amount,
        nextOccurrence: item.nextOccurrence,
        amountSource: item.amountSource,
        depositHistory: item.depositHistory,
        isVariable: item.isVariable,
      })
      return
    }
    Object.assign(form, {
      type: 'bill',
      name: '',
      cadence: 'monthly',
      accountId: accounts.value[0]?.id ?? '',
      amount: 0,
      nextOccurrence: today.value,
      amountSource: 'fixed',
      depositHistory: [],
      isVariable: false,
    })
  },
  { immediate: true },
)

const isValid = computed(() => form.name.trim().length > 0)
const namePlaceholder = computed(() =>
  form.type === 'bill' ? 'e.g. Electric & water' : 'e.g. Paycheck',
)

const canPredictHistory = computed(() => canPredict(form.depositHistory))

/**
 * A preview of what save would resolve to — reads through the same domain
 * function the store uses, so this can never drift from the saved figure.
 */
const predictedAmount = computed(() =>
  resolveAmount({
    id: props.item?.id ?? '',
    name: form.name,
    kind: form.type,
    amount: form.amount,
    cadence: form.cadence,
    accountId: form.accountId,
    nextOccurrence: form.nextOccurrence,
    amountSource: form.amountSource,
    depositHistory: form.depositHistory,
    isVariable: form.isVariable,
  }),
)

const showPredictedPanel = computed(
  () => form.type === 'income' && form.amountSource === 'predicted',
)

function onSave(): void {
  if (!isValid.value) return
  saveRecurringItem({
    ...(props.item ? { id: props.item.id } : {}),
    name: form.name.trim(),
    kind: form.type,
    amount: form.amount,
    cadence: form.cadence,
    accountId: form.accountId,
    nextOccurrence: form.nextOccurrence,
    // Bills are always fixed and never carry the variable flag — the
    // type-specific controls are hidden, not cleared, when switching tabs, so
    // the invariant is enforced here rather than trusting stale form state.
    amountSource: form.type === 'income' ? form.amountSource : 'fixed',
    depositHistory: form.depositHistory,
    isVariable: form.type === 'bill' ? form.isVariable : false,
  })
  emit('update:open', false)
}

function onDelete(): void {
  if (!props.item) return
  removeRecurringItem(props.item.id)
  emit('update:open', false)
}
</script>

<template>
  <ResponsiveEditor
    :open="props.open"
    :title="isEditing ? 'Edit recurring item' : 'Add recurring item'"
    @update:open="(value) => emit('update:open', value)"
  >
    <form class="flex flex-col gap-4" @submit.prevent="onSave">
      <Tabs
        :model-value="form.type"
        @update:model-value="(value) => value && (form.type = value as RecurringKind)"
      >
        <TabsList class="h-11 w-full">
          <TabsTrigger value="bill" class="flex-1">Bill</TabsTrigger>
          <TabsTrigger value="income" class="flex-1">Income</TabsTrigger>
        </TabsList>
      </Tabs>

      <div class="flex flex-col gap-2">
        <Label for="recurring-name">Name</Label>
        <Input
          id="recurring-name"
          v-model="form.name"
          :placeholder="namePlaceholder"
          autocomplete="off"
        />
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="flex flex-col gap-2">
          <Label for="recurring-cadence">Cadence</Label>
          <Select
            :model-value="form.cadence"
            @update:model-value="(value) => value && (form.cadence = value as Cadence)"
          >
            <SelectTrigger id="recurring-cadence" class="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="cadence in CADENCES" :key="cadence" :value="cadence">
                {{ formatCadence(cadence) }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="flex flex-col gap-2">
          <Label for="recurring-account">Account</Label>
          <Select
            :model-value="form.accountId"
            @update:model-value="(value) => value && (form.accountId = value as string)"
          >
            <SelectTrigger id="recurring-account" class="w-full">
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

      <div v-if="form.type === 'income'" class="flex flex-col gap-2">
        <Label>Amount source</Label>
        <ToggleGroup
          type="single"
          variant="outline"
          class="w-full gap-0 rounded-full bg-accent p-1"
          :model-value="form.amountSource"
          aria-label="Amount source"
          @update:model-value="(value) => value && (form.amountSource = value as AmountSource)"
        >
          <ToggleGroupItem
            value="fixed"
            class="h-11 flex-1 rounded-full border-0 bg-transparent text-sm font-medium data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm"
          >
            Fixed amount
          </ToggleGroupItem>
          <ToggleGroupItem
            value="predicted"
            :disabled="!canPredictHistory"
            :title="canPredictHistory ? undefined : 'Not enough deposit history yet'"
            class="h-11 flex-1 rounded-full border-0 bg-transparent text-sm font-medium data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm"
          >
            Predict from deposits
          </ToggleGroupItem>
        </ToggleGroup>
        <p v-if="!canPredictHistory" class="text-xs text-muted-foreground">
          Needs at least {{ MIN_DEPOSITS_FOR_PREDICTION }} recorded deposits before Runway can predict this amount.
        </p>
      </div>

      <PredictedAmountPanel
        v-if="showPredictedPanel"
        :predicted="predictedAmount"
        :deposit-count="form.depositHistory.length"
        :next-occurrence="form.nextOccurrence"
        @update:next-occurrence="(value) => (form.nextOccurrence = value)"
      />

      <div v-else class="grid grid-cols-2 gap-3">
        <div class="flex flex-col gap-2">
          <Label for="recurring-amount">Amount</Label>
          <MoneyInput id="recurring-amount" v-model="form.amount" aria-label="Amount" />
        </div>
        <div class="flex flex-col gap-2">
          <Label for="recurring-next-occurrence">Next occurrence</Label>
          <Input id="recurring-next-occurrence" v-model="form.nextOccurrence" type="date" class="font-mono" />
        </div>
      </div>

      <div v-if="form.type === 'bill'" class="flex items-start gap-3">
        <Checkbox
          id="recurring-variable"
          :model-value="form.isVariable"
          aria-describedby="recurring-variable-help"
          @update:model-value="(value) => (form.isVariable = value === true)"
        />
        <div class="grid gap-1">
          <Label for="recurring-variable" class="leading-snug">Amount varies each cycle</Label>
          <p id="recurring-variable-help" class="text-xs text-muted-foreground">
            Shows as an estimate, like a utility bill. Update it as real amounts come in.
          </p>
        </div>
      </div>

      <div v-if="confirmingDelete" role="alertdialog" class="rounded-md border border-destructive/30 bg-destructive/10 p-3">
        <p class="text-sm font-medium">Delete {{ props.item?.name }}?</p>
        <p class="mt-1 text-xs text-muted-foreground">This removes it from every future projection. This can't be undone.</p>
        <div class="mt-3 flex gap-2">
          <Button type="button" variant="destructive" size="sm" @click="onDelete">Delete</Button>
          <Button type="button" variant="ghost" size="sm" @click="confirmingDelete = false">
            Keep it
          </Button>
        </div>
      </div>

      <div class="flex items-center justify-between gap-2 pt-1">
        <Button
          v-if="isEditing"
          type="button"
          variant="ghost"
          class="text-destructive hover:text-destructive"
          @click="confirmingDelete = true"
        >
          Delete
        </Button>
        <span v-else />

        <div class="flex gap-2">
          <Button type="button" variant="outline" @click="emit('update:open', false)">Cancel</Button>
          <Button type="submit" :disabled="!isValid">
            {{ isEditing ? 'Save changes' : 'Add recurring item' }}
          </Button>
        </div>
      </div>
    </form>
  </ResponsiveEditor>
</template>
