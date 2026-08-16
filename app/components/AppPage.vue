<script setup lang="ts">
/**
 * The shared page container: one centered column with a consistent gutter.
 *
 * Resolves the max-width conflict flagged in `docs/design/dashboard/spec.md`.
 * Every screen is a single centered column; the cap is the one thing that
 * varies, and it varies through this enumerated prop rather than each page
 * inventing its own. Three values, each with a reason:
 *
 * - `narrow` (480px) — onboarding, a deliberately focused one-thing-at-a-time flow.
 * - `default` (640px) — every ordinary screen.
 * - `wide` (1160px) — the dashboard only, whose chart and verdict card are meant
 *   to be compared side by side on a wide screen.
 *
 * Below the cap the column is full-width but never edge to edge: the layout's
 * `p-4` keeps a 16px gutter, matching the padding used at the extreme edges
 * everywhere else in the app.
 */
import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<{
    title?: string
    subtitle?: string
    width?: 'narrow' | 'default' | 'wide'
    /** Centers the title block, as the shortfall screen does on desktop. */
    centerTitle?: boolean
  }>(),
  { width: 'default', centerTitle: false },
)

// Written out in full so Tailwind's scanner can see them.
const WIDTHS = {
  narrow: 'max-w-[480px]',
  default: 'max-w-[640px]',
  wide: 'max-w-[1160px]',
} as const
</script>

<template>
  <div :class="cn('mx-auto flex w-full flex-col gap-4', WIDTHS[props.width])">
    <div
      v-if="props.title || props.subtitle || $slots.actions"
      class="flex flex-wrap items-start justify-between gap-3"
    >
      <div :class="cn('min-w-0', props.centerTitle && 'w-full text-center')">
        <h1 v-if="props.title" class="text-2xl font-semibold tracking-tight lg:text-3xl">
          {{ props.title }}
        </h1>
        <p v-if="props.subtitle" class="mt-1 text-sm text-muted-foreground">
          {{ props.subtitle }}
        </p>
      </div>
      <div v-if="$slots.actions" class="shrink-0">
        <slot name="actions" />
      </div>
    </div>

    <slot />
  </div>
</template>
