<script setup lang="ts">
/**
 * A money field, bound in integer minor units.
 *
 * The component's contract is the app's money rule made mechanical: the
 * `modelValue` in and out is always integer cents, and the major-unit float
 * exists only inside this component, between the keystroke and the conversion.
 * No caller ever sees a monetary float.
 */
import { computed, ref, watch } from 'vue'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { MinorUnits } from '~~/domain/money'
import { toMajorUnits, toMinorUnits } from '~~/domain/money'

const props = withDefaults(
  defineProps<{
    modelValue: MinorUnits
    id?: string
    placeholder?: string
    min?: number
    disabled?: boolean
    /** Spoken name; the `$` prefix is decorative so the unit must be said here. */
    ariaLabel?: string
  }>(),
  { min: 0, disabled: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: MinorUnits] }>()

// Kept as a string so a half-typed "12." is not fought with mid-keystroke.
const draft = ref(String(toMajorUnits(props.modelValue)))

watch(
  () => props.modelValue,
  (next) => {
    if (toMinorUnits(Number(draft.value)) !== next) draft.value = String(toMajorUnits(next))
  },
)

function onInput(value: string | number): void {
  draft.value = String(value)
  const parsed = Number(draft.value)
  // A non-numeric entry coerces to 0 rather than erroring, matching the design.
  emit('update:modelValue', Number.isFinite(parsed) ? toMinorUnits(parsed) : 0)
}

const describedLabel = computed(() =>
  props.ariaLabel ? `${props.ariaLabel} in dollars` : 'Amount in dollars',
)
</script>

<template>
  <div
    :class="
      cn(
        'flex items-center gap-1.5 rounded-md border border-input bg-background px-3',
        'focus-within:ring-[3px] focus-within:ring-ring/50',
        props.disabled && 'opacity-50',
      )
    "
  >
    <span aria-hidden="true" class="font-mono text-sm text-muted-foreground">$</span>
    <Input
      :id="props.id"
      :model-value="draft"
      type="number"
      inputmode="decimal"
      :min="props.min"
      :placeholder="props.placeholder"
      :disabled="props.disabled"
      :aria-label="describedLabel"
      class="h-11 border-0 bg-transparent px-0 font-mono tabular-nums shadow-none focus-visible:ring-0 lg:h-9"
      @update:model-value="onInput"
    />
  </div>
</template>
