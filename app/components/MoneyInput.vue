<script setup lang="ts">
/**
 * A money field, bound in integer minor units.
 *
 * The component's contract is the app's money rule made mechanical: the
 * `modelValue` in and out is always integer cents, and the major-unit float
 * exists only inside `app/lib/money-input.ts`, between the keystroke and the
 * conversion. No caller ever sees a monetary float, and no parsing happens in
 * this file — it holds a draft string and renders two controls over it.
 *
 * **Negatives are opt-in, per field, via `allowNegative`.** An account balance
 * can be overdrawn; a safety cushion and a recurring item's amount cannot (the
 * schema says so too — `cushion_cents >= 0`, `amount_cents > 0`), so the
 * default is off and a typed minus is dropped there rather than accepted.
 *
 * **The sign toggle is not decoration — it is the only way to type a minus on
 * iOS.** A numeric keypad has no minus key, and neither `type="number"` nor
 * `inputmode="decimal"` puts one there, so a phone user could not enter an
 * overdrawn balance at all. The toggle gives every platform a way in; a typed
 * minus still works wherever the keyboard has one, and lands on the same draft
 * string. Not in `docs/design/accounts/spec.md`, which shows a bare `$` prefix
 * — a deviation raised in the PR rather than resolved silently.
 *
 * `type="text"` rather than `type="number"`: a number input blanks its own
 * value on a partial like `"-"`, which makes "minus, then digits" impossible,
 * and its step validation rejects `"812.34"` as a step mismatch unless
 * `step="0.01"` is set. `inputmode="decimal"` keeps the numeric keypad on
 * mobile, which is the only thing `type="number"` was buying here.
 */
import { computed, ref, watch } from 'vue'
import { Input } from '@/components/ui/input'
import { MINUS } from '@/lib/format'
import { draftFor, draftValue, isNegative, sanitize, withSign } from '@/lib/money-input'
import { cn } from '@/lib/utils'
import type { MinorUnits } from '~~/domain/money'

const props = withDefaults(
  defineProps<{
    modelValue: MinorUnits
    id?: string
    placeholder?: string
    disabled?: boolean
    /** Offer the sign toggle and accept a typed minus. Off unless the field can hold one. */
    allowNegative?: boolean
    /** Spoken name; the `$` prefix is decorative so the unit must be said here. */
    ariaLabel?: string
  }>(),
  { disabled: false, allowNegative: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: MinorUnits] }>()

// Kept as a string so a half-typed "12." is not fought with mid-keystroke.
const draft = ref(draftFor(props.modelValue))

watch(
  () => props.modelValue,
  (next) => {
    if (draftValue(draft.value) !== next) draft.value = draftFor(next)
  },
)

const negative = computed(() => isNegative(draft.value))

/**
 * The magnitude alone. The sign is rendered by the toggle, so showing it in
 * the field too would read as `− $ -1234`; this way the control reads exactly
 * the way `formatMoney` renders the same amount back out.
 */
const shown = computed(() => withSign(draft.value, false))

function set(next: string): void {
  draft.value = next
  emit('update:modelValue', draftValue(next))
}

function onInput(value: string | number): void {
  set(sanitize(value, props.allowNegative))
}

function toggleSign(): void {
  set(withSign(draft.value, !negative.value))
}

const describedLabel = computed(() =>
  props.ariaLabel ? `${props.ariaLabel} in dollars` : 'Amount in dollars',
)
</script>

<template>
  <div
    :class="
      cn(
        'flex items-center gap-1.5 rounded-md border border-input bg-background pr-3',
        // The toggle brings its own generous hit area, so it sits nearer the
        // edge than the bare `$` prefix does.
        props.allowNegative ? 'pl-1' : 'pl-3',
        'focus-within:ring-[3px] focus-within:ring-ring/50',
        props.disabled && 'opacity-50',
      )
    "
  >
    <!--
      A real toggle button, not a glyph: `aria-pressed` is what tells a screen
      reader the field is currently negative, since the minus in the value is
      rendered here rather than inside the text input.
    -->
    <button
      v-if="props.allowNegative"
      type="button"
      :disabled="props.disabled"
      aria-label="Negative amount"
      :aria-pressed="negative"
      :class="
        cn(
          'flex h-11 w-9 shrink-0 items-center justify-center rounded-md font-mono text-sm lg:h-9',
          'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
          negative ? 'bg-destructive/10 text-destructive' : 'text-muted-foreground',
        )
      "
      @click="toggleSign"
    >
      <span aria-hidden="true">{{ negative ? MINUS : '+' }}</span>
    </button>
    <span aria-hidden="true" class="font-mono text-sm text-muted-foreground">$</span>
    <Input
      :id="props.id"
      :model-value="shown"
      type="text"
      inputmode="decimal"
      autocomplete="off"
      :placeholder="props.placeholder"
      :disabled="props.disabled"
      :aria-label="describedLabel"
      class="h-11 border-0 bg-transparent px-0 font-mono tabular-nums shadow-none focus-visible:ring-0 lg:h-9"
      @update:model-value="onInput"
    />
  </div>
</template>
