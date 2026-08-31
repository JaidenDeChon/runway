<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { useVModel } from '@vueuse/core'
import { FIELD_DISABLED, FIELD_FOCUS, FIELD_INVALID, FIELD_SHELL } from '@/lib/field'
import { cn } from '@/lib/utils'

const props = defineProps<{
  defaultValue?: string | number
  modelValue?: string | number
  class?: HTMLAttributes['class']
}>()

const emits = defineEmits<{
  (e: 'update:modelValue', payload: string | number): void
}>()

const modelValue = useVModel(props, 'modelValue', emits, {
  passive: true,
  defaultValue: props.defaultValue,
})
</script>

<template>
  <input
    v-model="modelValue"
    data-slot="input"
    :class="cn(
      // Shell, focus, invalid and disabled come from `@/lib/field` so that
      // MoneyInput's wrapper cannot drift from this one again. What stays here
      // is what only a real `<input>` has: file-picker parts and a placeholder.
      FIELD_SHELL,
      FIELD_FOCUS,
      FIELD_INVALID,
      FIELD_DISABLED,
      'file:h-7 file:text-sm file:font-medium file:inline-flex file:border-0 file:bg-transparent file:text-foreground',
      'placeholder:text-muted-foreground',
      // WebKit gives `input[type=date]` an intrinsic control width that ignores
      // `w-full`, which is what pushed the account editor's date field past its
      // grid column. Neutralising the native appearance makes it size like
      // every other field; the calendar indicator is restored below.
      '[&[type=date]]:appearance-none',
      props.class,
    )"
  >
</template>
