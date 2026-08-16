<script setup lang="ts">
/**
 * The verdict: badge, headline, sub-line, and the three-stat row.
 *
 * Purely presentational. `verdict` already carries the covered/short
 * determination and the margin from `domain/projection`'s `evaluate()` — this
 * only picks copy and color for what the engine decided, and never derives a
 * balance itself.
 */
import { computed } from 'vue'
import MoneyText from '@/components/MoneyText.vue'
import StatCell from '@/components/shortfall/StatCell.vue'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { formatDateShort, formatMoney } from '@/lib/format'
import type { IsoDate } from '~~/domain/dates'
import type { MinorUnits } from '~~/domain/money'
import type { Verdict } from '~~/domain/projection'

const props = defineProps<{
  verdict: Verdict
  todayBalance: MinorUnits
  targetDate: IsoDate
  cushion: MinorUnits
  today: IsoDate
}>()

const targetLabel = computed(() => formatDateShort(props.targetDate))

// `margin` is already `lowest − cushion`, computed by the engine. The short
// headline just reframes that same figure ("need X more" instead of "have X
// to spare") — the sign flip is presentation, not a new financial fact.
const marginMagnitude = computed(() => formatMoney(Math.abs(props.verdict.margin)))
const cushionText = computed(() => formatMoney(props.cushion))

const lowestLabel = computed(() => {
  const lowest = props.verdict.lowest
  if (!lowest) return null
  const suffix = lowest.date === props.today ? ' (today)' : ''
  return `${formatDateShort(lowest.date)}${suffix}`
})
</script>

<template>
  <Card>
    <CardContent class="flex flex-col gap-4 lg:items-center lg:text-center">
      <!-- Announces itself to a screen reader on every cushion keystroke,
           since the badge/headline/sub-line change with no focus movement. -->
      <Transition name="verdict-fade" mode="out-in">
        <div :key="props.verdict.isCovered ? 'covered' : 'short'" aria-live="polite" class="flex flex-col gap-2 lg:items-center">
          <Badge :class="props.verdict.isCovered ? 'bg-chart-positive/16 text-chart-positive' : 'bg-destructive/16 text-destructive'">
            {{ props.verdict.isCovered ? 'Covered' : 'Short' }}
          </Badge>

          <h2
            :class="[
              'text-[32px] leading-tight font-bold lg:text-[42px]',
              props.verdict.isCovered ? 'text-foreground' : 'text-destructive',
            ]"
          >
            {{ props.verdict.isCovered ? "You're covered." : `You need ${marginMagnitude} more.` }}
          </h2>

          <p class="text-sm text-muted-foreground">
            <template v-if="props.verdict.isCovered">
              You'll have {{ marginMagnitude }} to spare above your cushion through {{ targetLabel }}.
            </template>
            <template v-else>
              to keep {{ cushionText }} in reserve through {{ targetLabel }}.
            </template>
          </p>
        </div>
      </Transition>

      <Separator />

      <div class="grid w-full grid-cols-3 gap-4 lg:max-w-xs lg:justify-items-center">
        <StatCell label="Today">
          <MoneyText :amount="props.todayBalance" />
        </StatCell>
        <StatCell label="Lowest point">
          <MoneyText :amount="props.verdict.lowest?.balance ?? 0" />
        </StatCell>
        <StatCell label="On">
          <span class="font-mono">{{ lowestLabel ?? '—' }}</span>
        </StatCell>
      </div>
    </CardContent>
  </Card>
</template>

<style scoped>
.verdict-fade-enter-active,
.verdict-fade-leave-active {
  transition: opacity 150ms ease;
}
.verdict-fade-enter-from,
.verdict-fade-leave-to {
  opacity: 0;
}
</style>
