<script setup lang="ts">
/**
 * The "this already happened" marker — issue #26's manual half.
 *
 * There is no design for settlement, so this is built from the vocabulary the
 * rows already use: a `Badge`, real text rather than a colour-only telling,
 * and a check glyph that is decoration (`aria-hidden`) because the word says
 * everything. `secondary` rather than `--chart-positive`: that token means
 * "money went up", and a paid bill is money going down — borrowing it would
 * make a settled bill read as a gain. `secondary` is theme-aware in both
 * directions, which is the whole of what this needed from a colour.
 *
 * "Paid" for money out, "Received" for money in — `settledWord`.
 */
import { CircleCheck } from '@lucide/vue'
import { Badge } from '@/components/ui/badge'
import { settledWord } from '@/lib/occurrence-editor'
import type { MinorUnits } from '~~/domain/money'

const props = defineProps<{
  /** The rule's own signed amount for the date — its sign says which word. */
  projectedAmount: MinorUnits
}>()
</script>

<template>
  <Badge variant="secondary" class="shrink-0 gap-1">
    <CircleCheck aria-hidden="true" class="size-3" />
    {{ settledWord(props.projectedAmount) }}
  </Badge>
</template>
