<script setup lang="ts">
/**
 * One cell of the verdict card's three-column stat row (Today / Lowest
 * point / On). The label stays sentence case in source — it is only made to
 * look uppercase via `uppercase`, so a screen reader says "Today" and not
 * "T O D A Y".
 */
defineProps<{ label: string }>()
</script>

<template>
  <div class="flex flex-col gap-1">
    <span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{{ label }}</span>
    <span class="text-sm font-semibold"><slot /></span>
  </div>
</template>
