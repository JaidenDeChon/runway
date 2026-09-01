<script setup lang="ts">
/**
 * The recurring-item form — one body, mounted into a Sheet or a Dialog by
 * `ResponsiveEditor`. Mirrors `AccountEditor`'s shape and its deliberate
 * deviations from the export:
 *
 * - **Save is disabled while the name is blank**, rather than the export's
 *   silent no-op.
 * - **Delete asks first.** The spec leaves this an open question ("no
 *   confirmation and no undo" vs. a confirm step); `AccountEditor` already
 *   answered it for this app, so the same inline confirm is used here rather
 *   than inventing a second answer to the same question.
 * - **An ends-on control**, which the design never drew (spec.md open
 *   question 11: "Cadence has no end date, no skip, and no 'last
 *   occurrence'") but issue #8 requires as a first-class verb — ending a rule
 *   stops future occurrences without erasing past ones.
 *
 * Predicted income is resolved by `useRunwayData().saveRecurringItem` at save
 * time — this form only *previews* the predicted figure, via the same
 * `resolveAmount` the store calls, so the preview and the saved value can
 * never disagree.
 *
 * Every write is async and can fail — a dropped connection, an expired
 * session — so `saving`/`deleting` disable the buttons and a failure renders
 * inline rather than closing the editor out from under whatever the user typed.
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
import { SEGMENTED_SEGMENT, SEGMENTED_TRACK } from '@/lib/segmented-control'
import { cn } from '@/lib/utils'
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
const saving = ref(false)
const deleting = ref(false)
const errorMessage = ref<string | null>(null)

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
  hasEndsOn: false,
  // Always holds a real date, even unticked, so ticking the checkbox has a
  // sane value to show immediately rather than an empty date input.
  endsOn: today.value as IsoDate,
  // No control on this screen writes these three — `daysOfMonth`/`daysOfWeek`
  // arrive from a screen that doesn't exist yet, and `startsOn` is only ever
  // set by the apply-to-future split described in `domain/types.ts`. They are
  // carried here anyway, `undefined` unless an edited item already had one, so
  // saving an *unrelated* field change round-trips them unchanged instead of
  // nulling them — the same failure shape `endsOn`'s idiom already guards
  // against, extended to fields the form cannot show or edit.
  daysOfMonth: undefined as readonly number[] | undefined,
  daysOfWeek: undefined as readonly number[] | undefined,
  startsOn: undefined as IsoDate | undefined,
})

watch(
  () => [props.open, props.item] as const,
  ([open, item]) => {
    if (!open) return
    confirmingDelete.value = false
    errorMessage.value = null
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
        hasEndsOn: item.endsOn !== undefined,
        endsOn: item.endsOn ?? today.value,
        daysOfMonth: item.daysOfMonth,
        daysOfWeek: item.daysOfWeek,
        startsOn: item.startsOn,
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
      hasEndsOn: false,
      endsOn: today.value,
      daysOfMonth: undefined,
      daysOfWeek: undefined,
      startsOn: undefined,
    })
  },
  { immediate: true },
)

// A blank name or a zero amount both fail to save: recurring_rules has
// `amount_cents > 0`, so a $0 item cannot reach the database, and Save
// being disabled until it's real is this app's existing answer to that
// (spec.md open question 8) — the same stance the blank-name guard already
// took, just extended to the other field the constraint actually depends on.
const isValid = computed(() => form.name.trim().length > 0 && form.amount > 0)
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

async function onSave(): Promise<void> {
  if (!isValid.value) return
  saving.value = true
  errorMessage.value = null
  try {
    await saveRecurringItem({
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
      // Unticked -> absent, not `endsOn: undefined` — `exactOptionalPropertyTypes`
      // distinguishes the two, and the DB enforces `ends_on >= starts_on`
      // for whatever comes through here regardless.
      ...(form.hasEndsOn ? { endsOn: form.endsOn } : {}),
      // Round-tripped, not editable here — see the form field's own comment.
      // Omitting these when the item never had one keeps a brand-new item's
      // payload exactly as before; carrying them when it did is what stops an
      // unrelated field edit from silently nulling them out.
      ...(form.daysOfMonth ? { daysOfMonth: form.daysOfMonth } : {}),
      ...(form.daysOfWeek ? { daysOfWeek: form.daysOfWeek } : {}),
      ...(form.startsOn ? { startsOn: form.startsOn } : {}),
    })
    emit('update:open', false)
  } catch {
    errorMessage.value = 'Could not save this item. Check your connection and try again.'
  } finally {
    saving.value = false
  }
}

async function onDelete(): Promise<void> {
  if (!props.item) return
  deleting.value = true
  errorMessage.value = null
  try {
    await removeRecurringItem(props.item.id)
    emit('update:open', false)
  } catch {
    errorMessage.value = 'Could not delete this item. Check your connection and try again.'
  } finally {
    deleting.value = false
  }
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
        <TabsList :class="cn(SEGMENTED_TRACK, 'h-11 w-full')">
          <TabsTrigger value="bill" :class="cn(SEGMENTED_SEGMENT, 'flex-1')">Bill</TabsTrigger>
          <TabsTrigger value="income" :class="cn(SEGMENTED_SEGMENT, 'flex-1')">Income</TabsTrigger>
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
        <div class="flex min-w-0 flex-col gap-2">
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
        <div class="flex min-w-0 flex-col gap-2">
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
          :class="cn(SEGMENTED_TRACK, 'w-full gap-0')"
          :model-value="form.amountSource"
          aria-label="Amount source"
          @update:model-value="(value) => value && (form.amountSource = value as AmountSource)"
        >
          <ToggleGroupItem
            value="fixed"
            :class="cn(SEGMENTED_SEGMENT, 'h-11 flex-1 text-sm font-medium')"
          >
            Fixed amount
          </ToggleGroupItem>
          <ToggleGroupItem
            value="predicted"
            :disabled="!canPredictHistory"
            :title="canPredictHistory ? undefined : 'Not enough deposit history yet'"
            :class="cn(SEGMENTED_SEGMENT, 'h-11 flex-1 text-sm font-medium')"
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
        <div class="flex min-w-0 flex-col gap-2">
          <Label for="recurring-amount">Amount</Label>
          <MoneyInput id="recurring-amount" v-model="form.amount" aria-label="Amount" />
        </div>
        <div class="flex min-w-0 flex-col gap-2">
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

      <div class="flex flex-col gap-2">
        <div class="flex items-start gap-3">
          <Checkbox
            id="recurring-has-end"
            :model-value="form.hasEndsOn"
            aria-describedby="recurring-has-end-help"
            @update:model-value="(value) => (form.hasEndsOn = value === true)"
          />
          <Label for="recurring-has-end" class="leading-snug">This rule ends on a date</Label>
        </div>
        <div v-if="form.hasEndsOn" class="flex flex-col gap-2 pl-7">
          <Label for="recurring-ends-on">Last occurrence</Label>
          <Input id="recurring-ends-on" v-model="form.endsOn" type="date" class="w-full font-mono" />
        </div>
        <p id="recurring-has-end-help" class="pl-7 text-xs text-muted-foreground">
          Past occurrences stay. Nothing new is projected after this date.
        </p>
      </div>

      <div v-if="confirmingDelete" role="alertdialog" class="rounded-md border border-destructive/30 bg-destructive/10 p-3">
        <p class="text-sm font-medium">Delete {{ props.item?.name }}?</p>
        <p class="mt-1 text-xs text-muted-foreground">This removes it from every future projection. This can't be undone.</p>
        <div class="mt-3 flex gap-2">
          <Button type="button" variant="destructive" size="sm" :disabled="deleting" @click="onDelete">
            Delete
          </Button>
          <Button type="button" variant="ghost" size="sm" :disabled="deleting" @click="confirmingDelete = false">
            Keep it
          </Button>
        </div>
      </div>

      <p v-if="errorMessage" role="alert" class="text-sm text-destructive">{{ errorMessage }}</p>

      <div class="flex items-center justify-between gap-2 pt-1">
        <Button
          v-if="isEditing"
          type="button"
          variant="ghost"
          class="text-destructive hover:text-destructive"
          :disabled="saving"
          @click="confirmingDelete = true"
        >
          Delete
        </Button>
        <span v-else />

        <div class="flex gap-2">
          <Button type="button" variant="outline" @click="emit('update:open', false)">Cancel</Button>
          <Button type="submit" :disabled="!isValid || saving">
            {{ isEditing ? 'Save changes' : 'Add recurring item' }}
          </Button>
        </div>
      </div>
    </form>
  </ResponsiveEditor>
</template>
