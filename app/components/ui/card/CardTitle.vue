<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes['class']
    /**
     * The element to render. Defaults to `div`, which is what the registry
     * ships and what every existing caller gets.
     *
     * Added because a card title is sometimes the page's actual heading — the
     * auth screens are a whole page that is one card — and a screen whose title
     * is a `div` exposes no heading to assistive technology at all. `CLAUDE.md`
     * says accessibility overrides the design without discussion, so the choice
     * of element belongs to the caller rather than being fixed at `div`.
     *
     * Backwards-compatible by construction: omit it and nothing changes. Pass
     * `h1`/`h2` where the title is genuinely a heading in the document outline;
     * do not pass one where a card is a section among many, or the page ends up
     * with several competing `h1`s.
     */
    as?: string
  }>(),
  { as: 'div' },
)
</script>

<template>
  <component
    :is="props.as"
    data-slot="card-title"
    :class="cn('text-base font-medium cn-font-heading', props.class)"
  >
    <slot />
  </component>
</template>
