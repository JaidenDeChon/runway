<script setup lang="ts">
/**
 * The "Line color" swatch row, shared by the accounts editor and onboarding.
 *
 * Built as a real radio group rather than three buttons with a ring: selection
 * is single-choice state, and the export's version exposed it through a visual
 * ring alone with the raw token id (`chart-2`) as its label — unusable by
 * keyboard and meaningless read aloud. Swatches are 44px to clear the touch
 * minimum, with the visible dot smaller inside.
 */
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { ACCOUNT_COLOR_CLASSES } from '@/lib/account-colors'
import { cn } from '@/lib/utils'
import type { AccountColor } from '~~/domain/types'
import { ACCOUNT_COLORS } from '~~/domain/types'

const props = defineProps<{ modelValue: AccountColor; name?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: AccountColor] }>()
</script>

<template>
  <RadioGroup
    :model-value="props.modelValue"
    :name="props.name"
    class="flex flex-row items-center gap-1"
    aria-label="Line color"
    @update:model-value="(value) => emit('update:modelValue', value as AccountColor)"
  >
    <label
      v-for="color in ACCOUNT_COLORS"
      :key="color"
      :class="
        cn(
          'flex size-11 cursor-pointer items-center justify-center rounded-full',
          'hover:bg-accent has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50',
        )
      "
    >
      <RadioGroupItem :value="color" class="sr-only" />
      <span
        aria-hidden="true"
        :class="
          cn(
            'size-7 rounded-full ring-offset-2 ring-offset-background transition-shadow',
            ACCOUNT_COLOR_CLASSES[color].background,
            props.modelValue === color && 'ring-2 ring-foreground',
          )
        "
      />
      <span class="sr-only">{{ ACCOUNT_COLOR_CLASSES[color].label }}</span>
    </label>
  </RadioGroup>
</template>
