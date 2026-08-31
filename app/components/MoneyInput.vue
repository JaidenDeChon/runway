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
 *
 * The box around all that comes from `@/lib/field`, not from here. It used to
 * be hand-rolled, and it drifted from `Input` on radius, fill and height at
 * once — three fields in one row of the account editor, one of them visibly a
 * different control. Nothing below may re-specify a shell property.
 */
import { computed, ref, useTemplateRef, watch } from 'vue'
import { Input } from '@/components/ui/input'
import { FIELD_FOCUS_WITHIN, FIELD_SHELL, FIELD_UNSTYLED } from '@/lib/field'
import { MINUS } from '@/lib/format'
import { applyTyped, draftFor, draftValue, isNegative, withSign } from '@/lib/money-input'
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
  // `applyTyped`, not `sanitize`: the field shows no sign, so its value comes
  // back unsigned and the current one has to be carried across. See that
  // function for the balance this silently corrupted.
  set(applyTyped(draft.value, value, props.allowNegative))
}

const field = useTemplateRef<{ $el?: unknown } | HTMLInputElement>('field')

/** The real `<input>`, whether the ref resolved to the element or the component. */
function inputElement(): HTMLInputElement | null {
  const value: unknown = field.value
  if (value instanceof HTMLInputElement) return value
  const el = (value as { $el?: unknown } | null)?.$el
  return el instanceof HTMLInputElement ? el : null
}

/**
 * Whether the caret was in the field when the toggle was pressed.
 *
 * Read on `mousedown`, which fires before any focus moves — by `click` the
 * answer has already changed.
 */
let hadFocus = false

/**
 * Keeps the keyboard up.
 *
 * Pressing the toggle would otherwise move focus to the button, and on a phone
 * that dismisses the keyboard mid-amount — which is the only time anyone
 * touches this control. Preventing the default on `mousedown` stops the focus
 * shift before it happens, and the explicit refocus in `toggleSign` covers any
 * engine that shifts it anyway.
 *
 * Deliberately not unconditional: a keyboard user who tabs to the button and
 * presses Space generates no `mousedown`, so `hadFocus` stays false and focus
 * stays where they put it rather than being yanked into the text field.
 */
function keepFocus(event: MouseEvent): void {
  hadFocus = document.activeElement === inputElement()
  event.preventDefault()
}

function toggleSign(): void {
  set(withSign(draft.value, !negative.value))
  if (hadFocus) inputElement()?.focus()
  hadFocus = false
}

const describedLabel = computed(() =>
  props.ariaLabel ? `${props.ariaLabel} in dollars` : 'Amount in dollars',
)
</script>

<template>
  <div
    :class="
      cn(
        FIELD_SHELL,
        FIELD_FOCUS_WITHIN,
        'flex items-center gap-1.5',
        // The wrapper is not a focusable element, so `disabled:` variants never
        // match it — the dimming has to be applied directly.
        props.disabled && 'pointer-events-none cursor-not-allowed opacity-50',
      )
    "
  >
    <!--
      The sign and the `$` are one control, not two things side by side.

      Three problems solve together that way. The prefix starts at the shell's
      own 12px inset, so `− $ 2,140` lines up with the text in every other
      field instead of sitting 30px in behind a toggle. There is no fill to
      expose a gap — the glyph flipping between `+` and `−` says more than a
      tinted rectangle did, and it is what the field reads out as. And the hit
      area covers both glyphs rather than a single 16px character.

      `aria-pressed` is what tells a screen reader the field is negative, since
      the minus lives here rather than inside the text input. Both glyphs are
      `aria-hidden`; the button's own label carries the meaning.
    -->
    <button
      v-if="props.allowNegative"
      type="button"
      :disabled="props.disabled"
      aria-label="Negative amount"
      :aria-pressed="negative"
      :class="
        cn(
          // Pulled back by its own padding so the glyphs, not the hit area,
          // align with the shell's inset.
          '-ml-2 flex h-11 shrink-0 items-center gap-1 rounded-full px-2 font-mono text-sm lg:h-9',
          'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
          negative ? 'text-destructive' : 'text-muted-foreground',
        )
      "
      @mousedown="keepFocus"
      @click="toggleSign"
    >
      <span aria-hidden="true">{{ negative ? MINUS : '+' }}</span>
      <span aria-hidden="true" class="text-muted-foreground">$</span>
    </button>
    <span v-else aria-hidden="true" class="font-mono text-sm text-muted-foreground">$</span>
    <Input
      :id="props.id"
      ref="field"
      :model-value="shown"
      type="text"
      inputmode="decimal"
      autocomplete="off"
      :placeholder="props.placeholder"
      :disabled="props.disabled"
      :aria-label="describedLabel"
      :class="cn(FIELD_UNSTYLED, 'font-mono tabular-nums')"
      @update:model-value="onInput"
    />
  </div>
</template>
