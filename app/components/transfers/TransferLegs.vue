<script setup lang="ts">
/**
 * from-swatch → arrow → to-swatch, the compact account pair used in each
 * recent-transfer row. The arrow is decorative — the row's own text already
 * says "Checking to Savings" — so it and the swatches are hidden from
 * assistive tech rather than each carrying a redundant label.
 */
import { ArrowRight } from '@lucide/vue'
import AccountSwatch from '@/components/AccountSwatch.vue'
import type { AccountColor } from '~~/domain/types'

defineProps<{ fromColor: AccountColor; toColor: AccountColor }>()
</script>

<template>
  <span class="inline-flex shrink-0 items-center gap-1.5">
    <AccountSwatch :color="fromColor" />
    <ArrowRight aria-hidden="true" class="size-3.5 text-muted-foreground" />
    <AccountSwatch :color="toColor" />
  </span>
</template>
