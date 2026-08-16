<script setup lang="ts">
/**
 * The two step-position pills above the onboarding card.
 *
 * Purely decorative: `aria-hidden`, because the step itself is announced by
 * moving focus to the labelled panel on change (see `first-run.vue`), not by
 * this. The current step's dot widens 6px → 18px; reached-but-not-current
 * dots stay narrow. `done` flattens that distinction — both dots read
 * `--primary` and neither widens, matching `screens/done.png`.
 */
import { cn } from '@/lib/utils'

const props = defineProps<{ current: number; total: number; done?: boolean }>()
</script>

<template>
  <div aria-hidden="true" class="flex items-center justify-center gap-1.5">
    <span
      v-for="step in props.total"
      :key="step"
      :class="
        cn(
          'h-1.5 rounded-full transition-[width] duration-150 motion-reduce:transition-none',
          step <= props.current ? 'bg-primary' : 'bg-border',
          !props.done && step === props.current ? 'w-[18px]' : 'w-1.5',
        )
      "
    />
  </div>
</template>
