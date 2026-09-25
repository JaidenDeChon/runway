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
 *
 * Issue #16 adds a third view — the discard confirmation — for the same
 * reason there are two: the design's answer to "second surface or swapped
 * body?" on this screen is a swapped body, and stacking an AlertDialog over
 * a bottom sheet at 375px is exactly the nesting that decision avoids.
 *
 * It guards the switch and nothing else. Closing no longer discards
 * anything, because the mode now outlives this sheet — `index.vue`'s
 * `setEditorOpen` carries that change and the spec deviation behind it. The
 * parent still owns the previews; this only asks before destroying them.
 *
 * Issue #15 made saving asynchronous and real: `saving`/`error` are props,
 * driven by `index.vue` the way `UpdateBalancesEditor` already is, and this
 * component only returns from the edit form to the item list once a save or
 * revert actually finishes without an error — not the instant the button is
 * pressed. `onSave` builds its payload from `editing.projectedDate` /
 * `.projectedAmount`, never `.date`/`.amount`: those are post-override values,
 * and keying a write on them would re-key it onto an already-moved date.
 *
 * Issue #26's manual half adds settlement — "Mark as paid" / "Mark as
 * received" — and there is no design for it. It lives here, on the one
 * occurrence you have opened, because that is where the two facts it needs
 * are already on screen: the amount and the date fields. The action records
 * *those* as what happened, so correcting a variable bill to what the bank
 * actually took and marking it paid is one form, not two. It is a callout
 * under the scope control rather than a third submit button: saving an edit
 * and recording a fact are different statements, and a row of three buttons
 * at 375px would not say which is which. A settled occurrence swaps the form
 * for a summary with an Undo, because `override_occurrence` refuses a settled
 * row — offering fields that cannot save would be a trap. What-if hides the
 * action entirely: the mode never writes, and a previewed settlement is not a
 * thing the engine has.
 */
import { CircleCheck } from '@lucide/vue'
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
import { formatDateLong, formatDateShort } from '@/lib/format'
import type {
  OccurrenceEdit,
  OccurrenceRevert,
  OccurrenceSettlement,
} from '@/lib/occurrence-editor'
import {
  overrideSummary,
  plannedSummary,
  settledWord,
  settleLabel,
  settlementDate,
  settlementProblem,
  splitConsequence,
} from '@/lib/occurrence-editor'
import { SEGMENTED_SEGMENT, SEGMENTED_TRACK } from '@/lib/segmented-control'
import { cn } from '@/lib/utils'
import { discardPrompt } from '@/lib/what-if'
import type { IsoDate } from '~~/domain/dates'
import type { MinorUnits } from '~~/domain/money'
import type { OverrideScope } from '~~/domain/overrides'
import { isEstimating } from '~~/domain/prediction'
import type { Occurrence } from '~~/domain/projection'
import type { Account, RecurringItem } from '~~/domain/types'

const props = defineProps<{
  open: boolean
  date: IsoDate | null
  occurrences: readonly Occurrence[]
  /** Every visible series' balance on this day, in legend order. */
  balances: readonly { key: string; name: string; balance: MinorUnits }[]
  accountsById: ReadonlyMap<string, Account>
  /** Looked up for the apply-to-future consequence sentence — `Cadence` lives on the rule, not the `Occurrence`. */
  recurringItemsById: ReadonlyMap<string, RecurringItem>
  whatIf: boolean
  /**
   * How many previewed edits the what-if session is holding.
   *
   * A count rather than a boolean because the confirmation names it, and
   * because "2 previewed changes will be lost" is the sentence that makes
   * the prompt worth stopping for.
   */
  whatIfEditCount: number
  saving: boolean
  error: string | null
  /** Settling records the past; a day that has not arrived is recorded as today (`settlementDate`). */
  today: IsoDate
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:whatIf': [value: boolean]
  save: [edit: OccurrenceEdit]
  revert: [target: OccurrenceRevert]
  settle: [settlement: OccurrenceSettlement]
  unsettle: [target: OccurrenceRevert]
}>()

const editing = ref<Occurrence | null>(null)

/**
 * Whether the user has asked to leave what-if and not yet confirmed.
 *
 * Only the switch asks. Closing the editor used to discard the previews and
 * so used to ask too, but the mode now outlives the sheet (see
 * `setEditorOpen` in `index.vue` and the deviation it records): closing
 * costs nothing, so stopping to confirm it would be a prompt about nothing —
 * exactly the kind people learn to dismiss unread. The bar that appears
 * behind the closed sheet carries the other exit, and its own confirmation.
 */
const pendingExit = ref(false)

/** Nothing previewed is nothing to lose — an untouched session must never stop to ask. */
const hasPreviews = computed(() => props.whatIf && props.whatIfEditCount > 0)

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
    // A confirmation left standing would greet the next day the user opens.
    pendingExit.value = false
  },
)

// Return to the item list only once a save or revert actually finishes
// without an error — not the instant the button is pressed, now that both
// are real network calls that can fail. What-if has no such moment to wait
// for (its "save" is a list append the parent makes synchronously and never
// reports back through `saving`), so it closes from `onSave` instead; both
// paths honour the design's "then returns to the item list"
// (docs/design/dashboard/spec.md § Interactions).
watch(
  () => props.saving,
  (saving, wasSaving) => {
    if (wasSaving && !saving && !props.error) editing.value = null
  },
)

/**
 * Turning the switch off is the one exit from here that destroys something.
 *
 * `ResponsiveEditor` is fully controlled, so refusing to emit would be how
 * this holds the sheet open — but it no longer needs to for closing, only
 * for the switch, which the swapped body below handles without touching
 * `update:open` at all.
 */
function requestWhatIf(on: boolean): void {
  if (on || !hasPreviews.value) {
    emit('update:whatIf', on)
    return
  }
  pendingExit.value = true
}

function confirmDiscard(): void {
  pendingExit.value = false
  emit('update:whatIf', false)
}

function keepPreviewing(): void {
  pendingExit.value = false
}

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
  // Compared against projectedDate, not the (possibly already-retimed) date
  // on screen — otherwise editing only the amount of an already-moved
  // occurrence would look like "no retime" and silently reset it back to its
  // rule date. Deliberately ignored for `future`: apply-to-future is
  // amount-only (docs/database/schema.md § "Rule splitting"; the date input
  // stays disabled below).
  const retimed = form.scope === 'once' && form.date !== occurrence.projectedDate
  emit('save', {
    itemId: occurrence.itemId,
    date: occurrence.projectedDate,
    scope: form.scope,
    amount: form.amount,
    projectedAmount: occurrence.projectedAmount,
    ...(retimed ? { newDate: form.date } : {}),
  })
  // A preview never round-trips, so there is no `saving` edge for the watch
  // above to close on.
  if (props.whatIf) editing.value = null
}

function onRevert(): void {
  const occurrence = editing.value
  if (!occurrence) return
  emit('revert', { itemId: occurrence.itemId, date: occurrence.projectedDate })
}

function onSettle(): void {
  const occurrence = editing.value
  if (!occurrence || settleBlocked.value) return
  emit('settle', {
    itemId: occurrence.itemId,
    date: occurrence.projectedDate,
    amount: form.amount,
    projectedAmount: occurrence.projectedAmount,
    actualDate: settlementDate(form.date, props.today),
  })
}

function onUnsettle(): void {
  const occurrence = editing.value
  if (!occurrence) return
  emit('unsettle', { itemId: occurrence.itemId, date: occurrence.projectedDate })
}

/**
 * The occurrence being looked at, kept current. `editing` is a snapshot taken
 * when the row was opened; after a settle or an undo the projection hands
 * over a new occurrence for the same `(itemId, projectedDate)`, and the panel
 * has to show that one — otherwise Undo would sit under a form that no
 * longer applies, until the editor closed.
 */
const current = computed(() => {
  const occurrence = editing.value
  if (!occurrence) return null
  return (
    props.occurrences.find(
      (candidate) =>
        candidate.itemId === occurrence.itemId &&
        candidate.projectedDate === occurrence.projectedDate,
    ) ?? occurrence
  )
})

const settled = computed(() => current.value?.isSettled === true)

const settledHeadline = computed(() => {
  const occurrence = current.value
  if (!occurrence?.isSettled) return ''
  return `${settledWord(occurrence.projectedAmount)} on ${formatDateShort(occurrence.date)}`
})

const settledPlanned = computed(() => {
  const occurrence = current.value
  if (!occurrence) return ''
  return plannedSummary({
    projectedAmount: occurrence.projectedAmount,
    projectedDate: occurrence.projectedDate,
  })
})

const settleProblem = computed(() => {
  const occurrence = editing.value
  if (!occurrence) return null
  return settlementProblem({ amount: form.amount, projectedAmount: occurrence.projectedAmount })
})

const settleBlocked = computed(() => props.saving || settleProblem.value !== null)

const settleText = computed(() => {
  const occurrence = editing.value
  if (!occurrence) return ''
  return settleLabel({
    projectedAmount: occurrence.projectedAmount,
    formDate: form.date,
    today: props.today,
  })
})

const title = computed(() => {
  if (pendingExit.value) return 'Discard what-if changes?'
  if (settled.value) return 'Settled occurrence'
  return editing.value ? 'Edit occurrence' : 'Day detail'
})
const subtitle = computed(() => (props.date ? formatDateLong(props.date) : ''))

const discardMessage = computed(() => discardPrompt(props.whatIfEditCount))

const editedSummary = computed(() => {
  const occurrence = editing.value
  if (!occurrence?.isOverridden) return null
  return overrideSummary({
    projectedAmount: occurrence.projectedAmount,
    projectedDate: occurrence.projectedDate,
  })
})

/** `null` when the item's cadence cannot be found (e.g. its rule no longer exists), which hides the block below rather than guessing a cadence. */
const futureConsequence = computed(() => {
  const occurrence = editing.value
  if (!occurrence || form.scope !== 'future') return null
  const item = props.recurringItemsById.get(occurrence.itemId)
  if (!item) return null
  return splitConsequence({
    label: occurrence.label,
    cadence: item.cadence,
    effectiveFrom: occurrence.projectedDate,
    amount: form.amount,
    estimating: isEstimating(item),
  })
})

const submitLabel = computed(() => {
  if (props.whatIf) return 'Preview change'
  return form.scope === 'future' ? 'Change all future' : 'Save change'
})
</script>

<template>
  <ResponsiveEditor
    :open="props.open"
    :title="title"
    :description="subtitle"
    @update:open="(value) => emit('update:open', value)"
  >
    <!-- The confirmation replaces the body rather than covering it: this
         editor's own pattern (see the note at the top), and the only one that
         behaves at 375px, where a second overlay over a bottom sheet leaves
         neither fully readable. -->
    <div v-if="pendingExit" class="flex flex-col gap-4">
      <p
        class="flex items-start gap-2 rounded-md border border-dashed border-chart-5 bg-chart-5/10 px-3 py-2 text-sm font-medium text-chart-5"
      >
        <span aria-hidden="true">◑</span>
        {{ discardMessage }}
      </p>

      <p class="text-sm text-muted-foreground">
        Turning what-if off drops the previews and puts the chart back to your saved numbers.
      </p>

      <div class="flex flex-col gap-2 lg:flex-row-reverse">
        <Button type="button" class="lg:flex-1" @click="keepPreviewing">Keep previewing</Button>
        <Button type="button" variant="outline" class="lg:flex-1" @click="confirmDiscard">
          Discard changes
        </Button>
      </div>
    </div>

    <div v-else class="flex flex-col gap-4">
      <!-- Sticky because `SheetContent` scrolls its own body at
           `max-h-[88vh]`: on a busy day at 375px this banner was the first
           thing to leave the screen, which is the scroll position issue #16
           cares about most — the one where you are reading amounts.

           The wrapper carries `bg-card` and the sticking; the banner keeps
           the tokens it already had. Putting an opaque layer behind the 10%
           tint rather than changing the tint is what stops the rows from
           showing through without inventing a colour the design never
           specified. --chart-5 is the what-if token everywhere on this
           screen; dark text on it in both themes because the ramp lightens
           for dark surfaces. -->
      <div v-if="props.whatIf" class="sticky top-0 z-10 -mt-1 bg-card pt-1">
        <p
          class="flex items-center gap-2 rounded-md border border-dashed border-chart-5 bg-chart-5/10 px-3 py-2 text-sm font-medium text-chart-5"
        >
          <span aria-hidden="true">◑</span>
          What-if — changes here won't be saved
        </p>
      </div>

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
          @update:model-value="(value) => requestWhatIf(value === true)"
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

      <!-- Settled: what happened, what was planned, and the way back. No
           fields — a settled row cannot be edited, only un-settled. -->
      <div v-else-if="settled" class="flex flex-col gap-4">
        <p class="text-sm font-medium">{{ current?.label }}</p>

        <div class="flex items-start gap-3 rounded-md border bg-muted/50 p-3">
          <CircleCheck aria-hidden="true" class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div class="min-w-0 flex-1">
            <p class="flex flex-wrap items-baseline justify-between gap-x-3 text-sm font-medium">
              <span>{{ settledHeadline }}</span>
              <MoneyText
                v-if="current"
                :amount="current.amount"
                :colored="current.amount > 0"
                :label="current.label"
                size="sm"
              />
            </p>
            <p class="mt-0.5 text-xs text-muted-foreground">{{ settledPlanned }}</p>
          </div>
        </div>

        <p v-if="props.whatIf" class="text-xs text-muted-foreground">
          Already settled, so what-if leaves it as it is.
        </p>

        <p v-if="props.error" role="alert" class="text-sm text-destructive">{{ props.error }}</p>

        <div class="flex gap-2">
          <Button
            type="button"
            variant="outline"
            class="flex-1"
            :disabled="props.saving"
            @click="editing = null"
          >
            Back
          </Button>
          <Button
            v-if="!props.whatIf"
            type="button"
            variant="outline"
            class="flex-1"
            :disabled="props.saving"
            @click="onUnsettle"
          >
            Undo {{ settledWord(current?.projectedAmount ?? 0).toLowerCase() }}
          </Button>
        </div>
      </div>

      <form v-else class="flex flex-col gap-4" @submit.prevent="onSave">
        <p class="text-sm font-medium">{{ editing?.label }}</p>

        <div
          v-if="editedSummary"
          class="flex items-center justify-between gap-3 rounded-md border border-dashed p-3"
        >
          <div class="min-w-0">
            <p class="text-sm font-medium">Edited</p>
            <p class="mt-0.5 text-xs text-muted-foreground">{{ editedSummary }}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            :disabled="props.saving"
            @click="onRevert"
          >
            Revert to rule value
          </Button>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="flex min-w-0 flex-col gap-2">
            <Label for="occurrence-amount">Amount</Label>
            <!-- Signed: a bill is stored as a negative delta, and hiding that
                 behind a magnitude field would make "is this in or out?"
                 unanswerable from the form. -->
            <MoneyInput
              id="occurrence-amount"
              v-model="form.amount"
              allow-negative
              aria-label="Amount"
            />
          </div>
          <div class="flex min-w-0 flex-col gap-2">
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
            :class="cn(SEGMENTED_TRACK, 'w-full')"
            @update:model-value="setScope"
          >
            <ToggleGroupItem
              value="once"
              :class="cn(SEGMENTED_SEGMENT, 'h-11 flex-1 lg:h-9')"
            >
              This occurrence only
            </ToggleGroupItem>
            <ToggleGroupItem
              value="future"
              :class="cn(SEGMENTED_SEGMENT, 'h-11 flex-1 lg:h-9')"
            >
              Apply to all future
            </ToggleGroupItem>
          </ToggleGroup>
          <p v-if="form.scope === 'future'" class="text-xs text-muted-foreground">
            {{
              futureConsequence ??
              'Rewrites the amount on every occurrence from this date onward. The date is left as it is.'
            }}
          </p>
        </div>

        <!-- Settlement (#26, manual half). Only for "this occurrence only":
             a settlement is a fact about one day, and apply-to-future is a
             plan for many. Uses the amount and date above, so it reads as a
             second thing to do with the same two fields. -->
        <div
          v-if="!props.whatIf && form.scope === 'once'"
          class="flex flex-col gap-3 rounded-md border bg-muted/50 p-3 sm:flex-row sm:items-center"
        >
          <div class="min-w-0 flex-1">
            <p id="occurrence-settle-label" class="text-sm font-medium">Already happened?</p>
            <p id="occurrence-settle-help" class="mt-0.5 text-xs text-muted-foreground">
              {{
                settleProblem ??
                'Records the amount and date above as what actually happened. Estimates learn from it.'
              }}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            class="shrink-0"
            :disabled="settleBlocked"
            aria-describedby="occurrence-settle-help"
            @click="onSettle"
          >
            <CircleCheck aria-hidden="true" class="size-4" />
            {{ settleText }}
          </Button>
        </div>

        <p v-if="props.error" role="alert" class="text-sm text-destructive">{{ props.error }}</p>

        <div class="flex gap-2">
          <Button
            type="button"
            variant="outline"
            class="flex-1"
            :disabled="props.saving"
            @click="editing = null"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            :disabled="props.saving"
            :class="
              cn('flex-1', props.whatIf && 'bg-chart-5 text-foreground hover:bg-chart-5/90 dark:text-background')
            "
          >
            {{ submitLabel }}
          </Button>
        </div>
      </form>
    </div>
  </ResponsiveEditor>
</template>
