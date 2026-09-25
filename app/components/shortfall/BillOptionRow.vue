<script setup lang="ts">
/**
 * One selectable bill in the shortfall calculator's RadioGroup.
 *
 * A real `<label>` wrapping the `RadioGroupItem`, same pattern as
 * `AccountColorPicker` — the whole row is the click target, not just the dot.
 * The export this was built from rendered hand-drawn dots with no
 * `<input type="radio">` at all, so nothing here is ported from it.
 *
 * Issue #18: a variable bill's amount is an estimate, and every other screen
 * that shows one marks it — so this does too, with the same `Est.` badge
 * (`UpcomingBill.isEstimated`). The shortfall design predates estimates and
 * has no marker of its own; this is the dashboard's reuse of the
 * recurring-items badge carried one screen further, not a new vocabulary.
 * The accessible name says "estimated" in words, because the radio's
 * `aria-label` replaces the row's visible text for a screen reader and the
 * badge's own expansion would never be heard.
 */
import EstimateBadge from '@/components/EstimateBadge.vue'
import MoneyText from '@/components/MoneyText.vue'
import { RadioGroupItem } from '@/components/ui/radio-group'
import { describeMoneySigned, formatDateShort } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { UpcomingBill } from '~~/domain/projection'

const props = defineProps<{ bill: UpcomingBill; selected: boolean }>()

// The visible row reads "Car payment / Aug 20 / -$310"; the accessible name
// has to say the same thing in one sentence, since a screen reader user never
// sees the three fragments laid out spatially.
const accessibleName = `${props.bill.label}, ${formatDateShort(props.bill.date)}, ${describeMoneySigned(props.bill.amount)}${props.bill.isEstimated ? ', estimated' : ''}`
</script>

<template>
  <label
    :class="
      cn(
        'flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-accent',
        props.selected && 'bg-accent',
      )
    "
  >
    <RadioGroupItem :value="props.bill.itemId" :aria-label="accessibleName" />
    <span class="min-w-0 flex-1">
      <span class="flex items-center gap-1.5">
        <span class="truncate font-medium">{{ props.bill.label }}</span>
        <EstimateBadge v-if="props.bill.isEstimated" aria-hidden="true" />
      </span>
      <span class="mt-0.5 block text-xs text-muted-foreground">{{ formatDateShort(props.bill.date) }}</span>
    </span>
    <MoneyText :amount="props.bill.amount" />
  </label>
</template>
