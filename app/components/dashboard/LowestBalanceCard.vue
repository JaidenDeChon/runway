<script setup lang="ts">
/**
 * The verdict card: the single lowest point the forecast reaches, and whether
 * that clears the safety cushion.
 *
 * Every figure and the band it falls in arrive from `evaluate()` — the covered /
 * tight / short thresholds are a product rule the engine owns, so this component
 * only chooses a tint and a word. The word is the point: the badge stays text,
 * never a bare colour, and the shortfall alert repeats the number rather than
 * leaving it to the red headline.
 */
import { computed } from 'vue'
import MoneyText from '@/components/MoneyText.vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { formatDateShort, formatDaysAway, formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { IsoDate } from '~~/domain/dates'
import { daysBetween } from '~~/domain/dates'
import type { Verdict } from '~~/domain/projection'

const props = defineProps<{ verdict: Verdict; today: IsoDate }>()

const BADGE_CLASSES: Record<Verdict['status'], string> = {
  covered: 'bg-chart-positive/12 text-chart-positive',
  // --chart-warning, not --chart-5: the amber that carries a verdict is a
  // verdict token, and --chart-5 is spoken for by what-if.
  tight: 'bg-chart-warning/12 text-chart-warning',
  short: 'bg-destructive/10 text-destructive',
}

const badgeLabel = computed(() => {
  if (props.verdict.status === 'covered') return 'Covered'
  if (props.verdict.status === 'tight') return 'Tight'
  return `Short by ${formatMoney(props.verdict.shortfall)}`
})

const meta = computed(() => {
  const lowest = props.verdict.lowest
  if (!lowest) return null
  const away = formatDaysAway(daysBetween(props.today, lowest.date))
  return `${formatDateShort(lowest.date)} · ${away === 'today' ? 'projected today' : away}`
})
</script>

<template>
  <Card class="gap-3">
    <div class="flex items-start justify-between gap-3 px-4 lg:px-6">
      <h2 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Lowest projected balance
      </h2>
      <Badge variant="secondary" :class="cn(BADGE_CLASSES[props.verdict.status])">
        {{ badgeLabel }}
      </Badge>
    </div>

    <div class="px-4 lg:px-6">
      <MoneyText
        v-if="props.verdict.lowest"
        :amount="props.verdict.lowest.balance"
        size="xl"
        :class="cn('font-semibold', props.verdict.status === 'short' && 'text-destructive')"
      />
      <p v-else class="text-sm text-muted-foreground">Nothing to project yet.</p>
      <p v-if="meta" class="mt-1 text-sm text-muted-foreground">{{ meta }}</p>
    </div>

    <div v-if="props.verdict.status === 'short'" class="px-4 lg:px-6">
      <Alert variant="destructive" class="border-destructive/30 bg-destructive/10">
        <AlertDescription>
          Projected to dip {{ formatMoney(props.verdict.shortfall) }} below your safety cushion on
          {{ props.verdict.lowest ? formatDateShort(props.verdict.lowest.date) : '' }}.
        </AlertDescription>
      </Alert>
    </div>

    <div class="px-4 lg:px-6">
      <NuxtLink
        to="/will-i-make-it"
        class="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        Will I make it?<span aria-hidden="true"> →</span>
      </NuxtLink>
    </div>
  </Card>
</template>
