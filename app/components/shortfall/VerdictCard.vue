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
  /** Whether a later target could still change the verdict — `laterTargetsMatter`. */
  laterTargetsMatter: boolean
  /** First day in the outlook horizon the cushion breaks, or `null` — `shortfallOutlook`. */
  firstBreach: IsoDate | null
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

/**
 * A second, target-independent fact about honesty, not the verdict itself —
 * see `shortfallOutlook` and `laterTargetsMatter`. Invented copy, no design
 * artifact behind it; raised in `docs/design/shortfall/spec.md`'s States
 * section per CLAUDE.md.
 *
 * Three branches, ordered by specificity rather than mutually exclusive by
 * construction — each condition below can be true at the same time as the
 * next one, so the first match wins:
 *
 * 1. Already short today: no target can do anything but reproduce that, and
 *    naming it directly is more useful than letting the picker look inert.
 * 2. Nothing later than the current target can move the verdict either way.
 * 3. Covered right now, but the cushion breaks somewhere further out.
 */
const outlookNote = computed(() => {
  if (props.firstBreach === props.today) {
    return 'You are below your cushion today, so every target starts short.'
  }
  if (!props.laterTargetsMatter) {
    return "Picking a later bill or date won't change this — your low point falls inside this window."
  }
  if (props.verdict.isCovered && props.firstBreach) {
    return `Look further out, though: your cushion breaks on ${formatDateShort(props.firstBreach)}.`
  }
  return null
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

          <p v-if="outlookNote" class="text-sm text-muted-foreground">{{ outlookNote }}</p>
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
