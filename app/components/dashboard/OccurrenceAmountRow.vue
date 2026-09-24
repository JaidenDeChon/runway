<script setup lang="ts">
/**
 * An Upcoming row whose amount is a field, not a figure.
 *
 * The dashboard's Upcoming list answers "what is coming?", and the question
 * people actually have while reading it is "what if that one were different?"
 * Answering it used to cost five interactions — open the day, pick the item,
 * type, choose a scope, save — and the chart, the thing you were trying to
 * move, was behind a modal for four of them. This row collapses that to type
 * and press: **Update one**, **Update all**, **Reset**.
 *
 * **Why this is not `OccurrenceRow` with a prop.** That component is a single
 * `<button>` wrapping the whole row, which is the right shape for a
 * navigational row and is what the day editor still uses. A field cannot live
 * inside a button — the markup is invalid and the click never reaches the
 * input — so an editable row is a different element tree, not a variant. The
 * two share their vocabulary (the date column, the swatch, the badge, the
 * mono amount) rather than their markup, and the identity half here is still a
 * real button that opens the day, so nothing that could be reached before is
 * unreachable now.
 *
 * **What each button does is decided in `app/lib/occurrence-amount.ts`**, not
 * here: which payload a scope builds (including the retime clause that stops
 * an inline amount edit from silently moving an already-moved occurrence back
 * to its rule date), what Reset means in each of four states, and every
 * spoken label. This file holds the draft, the markup and the emits.
 *
 * **Reset is one button with one meaning — "put this row back" — and three
 * implementations.** With what-if on it drops the preview and writes nothing;
 * with it off it reverts the stored override through the seam; with neither,
 * it just clears what was typed. `resetEffect` picks, and the button's spoken
 * label says which, so the destructive one is never silent.
 *
 * **Scaling down.** At 375px the identity and the field share the first line
 * and the three buttons wrap to a full-width line of their own, each an equal
 * third; from `lg` they sit inline at the row's end. The buttons are hidden
 * until the row has focus or something to undo — fourteen rows × three
 * buttons is a wall, and a row you are not editing has nothing to offer. The
 * reveal is `group-focus-within`, i.e. CSS: a JS focus flag would have to
 * decide whether a blur heading *into* one of the buttons should hide them
 * first, and gets it wrong the day it guesses.
 */
import { ChevronRight } from '@lucide/vue'
import AccountSwatch from '@/components/AccountSwatch.vue'
import EstimateBadge from '@/components/EstimateBadge.vue'
import MoneyInput from '@/components/MoneyInput.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDateShort } from '@/lib/format'
import {
  amountFieldLabel,
  isAmountDirty,
  type QuickScope,
  quickEdit,
  quickEditHint,
  resetEffect,
  resetLabel,
  updateAllLabel,
  updateOneLabel,
} from '@/lib/occurrence-amount'
import type { OccurrenceEdit } from '@/lib/occurrence-editor'
import { cn } from '@/lib/utils'
import type { IsoDate } from '~~/domain/dates'
import type { MinorUnits } from '~~/domain/money'
import type { Occurrence } from '~~/domain/projection'
import { isEstimated } from '~~/domain/projection'
import type { AccountColor } from '~~/domain/types'

const props = defineProps<{
  occurrence: Occurrence
  accountName: string
  accountColor: AccountColor
  today: IsoDate
  whatIf: boolean
  /** Whether the what-if session is holding a preview of this occurrence. */
  previewed: boolean
  /** False when the rule behind this occurrence is no longer loaded — a split has nothing to split. */
  canUpdateAll: boolean
  /** True while this row's own write is in flight. Only ever one row at a time. */
  pending: boolean
  /** This row's write failure, if the last one failed. */
  error: string | null
}>()

const emit = defineEmits<{
  select: []
  update: [edit: OccurrenceEdit]
  reset: []
}>()

/**
 * What the field holds, which is the row's only piece of state.
 *
 * Seeded from the occurrence and re-seeded whenever the projection moves it —
 * a successful write, a dropped preview, a horizon change. The row is keyed on
 * `(itemId, projectedDate)` by `UpcomingCard`, deliberately not on
 * `Occurrence.id`, which an override rewrites: keyed on the id, every edit
 * would remount this component and take the caret with it.
 */
const draft = ref<MinorUnits>(props.occurrence.amount)

watch(
  () => props.occurrence.amount,
  (amount) => {
    draft.value = amount
  },
)

const dirty = computed(() => isAmountDirty(draft.value, props.occurrence.amount))

const effect = computed(() =>
  resetEffect({
    whatIf: props.whatIf,
    previewed: props.previewed,
    isOverridden: props.occurrence.isOverridden,
    dirty: dirty.value,
  }),
)

/** A row with nothing to undo and nothing typed keeps its buttons out of the way until it is focused. */
const actionsPinned = computed(() => dirty.value || effect.value !== 'none')

const fieldLabel = computed(() => amountFieldLabel(props.occurrence.label, props.occurrence.date))
const hint = computed(() =>
  quickEditHint(props.occurrence.label, props.occurrence.date, props.whatIf),
)

function apply(scope: QuickScope): void {
  emit('update', quickEdit(props.occurrence, draft.value, scope))
}

/**
 * Clearing the field is unconditional; telling the page is not.
 *
 * `draft` and `override` are the two effects the page cannot see — the typed
 * value is this component's own, and the stored revert is the seam's — so the
 * field is put back here either way and only the effects that change stored or
 * previewed state travel upward.
 */
function onReset(): void {
  const wanted = effect.value
  draft.value = props.occurrence.amount
  if (wanted === 'preview' || wanted === 'override') emit('reset')
}
</script>

<template>
  <div
    class="group flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 transition-colors lg:px-5"
    :class="props.previewed && 'bg-chart-5/5'"
  >
    <button
      type="button"
      class="-mx-1 flex min-w-0 flex-1 basis-40 items-center gap-3 rounded-md px-1 py-1 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      @click="emit('select')"
    >
      <span class="w-16 shrink-0 text-xs text-muted-foreground lg:w-24">
        {{ formatDateShort(props.occurrence.date) }}
        <span v-if="props.today === props.occurrence.date"> · Today</span>
      </span>

      <span class="min-w-0 flex-1">
        <span class="flex items-center gap-1.5">
          <span class="truncate font-medium">{{ props.occurrence.label }}</span>
          <!-- Two different facts, so two different words: a preview is
               unsaved and a stored override is not, and the mode's amber says
               which without asking anyone to remember what the badge meant
               last time. -->
          <Badge
            v-if="props.previewed"
            variant="outline"
            class="shrink-0 border-chart-5 text-chart-5"
          >
            Previewed
          </Badge>
          <Badge
            v-else-if="props.occurrence.isOverridden"
            variant="outline"
            class="shrink-0"
          >
            Edited
          </Badge>
          <!-- Issue #18: the third fact — the figure in the field is an
               estimate. Last in the chain because a preview or an edit is the
               user's own figure and stops being one. -->
          <EstimateBadge v-else-if="isEstimated(props.occurrence)" />
        </span>
        <span class="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <AccountSwatch :color="props.accountColor" size="sm" />
          <span class="truncate">{{ props.accountName }}</span>
        </span>
        <span
          v-if="props.occurrence.isOverridden && props.occurrence.date !== props.occurrence.projectedDate"
          class="mt-0.5 block text-xs text-muted-foreground"
        >
          moved from {{ formatDateShort(props.occurrence.projectedDate) }}
        </span>
      </span>

      <ChevronRight aria-hidden="true" class="size-4 shrink-0 text-muted-foreground" />
    </button>

    <!-- Signed, like every other amount in the app: a bill is a negative
         delta, and a magnitude-only field would make "is this in or out?"
         unanswerable from the row it is on. -->
    <div class="w-32 shrink-0 lg:w-36">
      <MoneyInput
        v-model="draft"
        allow-negative
        :disabled="props.pending"
        :aria-label="fieldLabel"
      />
    </div>

    <div
      class="w-full items-center justify-end gap-2 lg:w-auto"
      :class="actionsPinned ? 'flex' : 'hidden group-focus-within:flex'"
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="flex-1 lg:flex-none"
        :disabled="!dirty || props.pending"
        :aria-label="updateOneLabel(props.occurrence.label, props.occurrence.date)"
        :class="cn(props.whatIf && dirty && 'border-chart-5 text-chart-5')"
        @click="apply('one')"
      >
        Update one
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="flex-1 lg:flex-none"
        :disabled="!dirty || props.pending || !props.canUpdateAll"
        :aria-label="updateAllLabel(props.occurrence.label, props.occurrence.date)"
        :class="cn(props.whatIf && dirty && props.canUpdateAll && 'border-chart-5 text-chart-5')"
        @click="apply('all')"
      >
        Update all
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="flex-1 lg:flex-none"
        :disabled="effect === 'none' || props.pending"
        :aria-label="resetLabel(props.occurrence.label, props.occurrence.date, effect)"
        @click="onReset"
      >
        Reset
      </Button>
    </div>

    <p v-if="dirty" class="w-full text-xs text-muted-foreground">{{ hint }}</p>
    <p v-if="props.error" role="alert" class="w-full text-sm text-destructive">
      {{ props.error }}
    </p>
  </div>
</template>
