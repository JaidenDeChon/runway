<script setup lang="ts">
/**
 * A monetary figure.
 *
 * Every amount in the app renders through this so the mono face, the tabular
 * figures and the signed/unsigned rules are decided in one place. It formats
 * and nothing else — the value arrives already computed by the domain engine.
 */
import { computed } from 'vue'
import { describeMoneySigned, formatMoney, formatMoneySigned } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { MinorUnits } from '~~/domain/money'

const props = withDefaults(
  defineProps<{
    amount: MinorUnits
    /** Show an explicit `+`/`−`, for figures whose direction is the point. */
    signed?: boolean
    /** Tint by direction. Off by default: a balance is not a gain or a loss. */
    colored?: boolean
    /** A noun for the spoken label, e.g. the item's name. */
    label?: string
    size?: 'sm' | 'base' | 'lg' | 'xl'
  }>(),
  { signed: false, colored: false, size: 'base' },
)

const SIZES = {
  sm: 'text-xs',
  base: 'text-sm',
  lg: 'text-lg',
  xl: 'text-3xl lg:text-4xl',
} as const

const text = computed(() =>
  props.signed ? formatMoneySigned(props.amount) : formatMoney(props.amount),
)

const tint = computed(() => {
  if (!props.colored) return ''
  if (props.amount > 0) return 'text-chart-positive'
  if (props.amount < 0) return 'text-destructive'
  return ''
})

/**
 * The `+`/`−` is a glyph, and colour carries the same meaning again — neither
 * survives being read aloud, so signed figures get an explicit spoken label.
 */
const spoken = computed(() =>
  props.signed || props.colored ? describeMoneySigned(props.amount, props.label) : undefined,
)
</script>

<template>
  <span
    :class="cn('font-mono tabular-nums', SIZES[props.size], tint)"
    :aria-label="spoken"
  >{{ text }}</span>
</template>
