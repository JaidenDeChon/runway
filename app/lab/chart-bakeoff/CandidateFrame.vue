<script setup lang="ts">
/**
 * The harness chrome every candidate page wraps its chart in: a width toggle
 * and a light/dark toggle.
 *
 * The 375px option is a real bordered 375px-wide container, not a viewport
 * simulation — so capability 8's gate is judged by anyone opening this page at
 * any window size, with no screenshot needed (the repo's rule against
 * committing rendered-balance images is absolute; this is how the harness
 * avoids needing them at all).
 *
 * The theme toggle flips the app's actual color mode (`useColorMode`), not a
 * scoped class — there is no per-component theming seam in this app, and
 * flipping the real thing is what makes "does this candidate re-resolve its
 * colours on a theme change" an honest, observable question rather than a
 * simulated one.
 */
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { SEGMENTED_SEGMENT, SEGMENTED_TRACK } from '@/lib/segmented-control'
import { cn } from '@/lib/utils'

const WIDTHS = ['375', 'full'] as const
type Width = (typeof WIDTHS)[number]

const width = ref<Width>('375')
const colorMode = useColorMode()

function setWidth(value: unknown): void {
  if (WIDTHS.some((candidate) => candidate === value)) width.value = value as Width
}

function setTheme(value: unknown): void {
  if (value === 'light' || value === 'dark') colorMode.preference = value
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-3">
      <ToggleGroup
        :model-value="width"
        type="single"
        aria-label="Frame width"
        :class="SEGMENTED_TRACK"
        @update:model-value="setWidth"
      >
        <ToggleGroupItem value="375" :class="cn(SEGMENTED_SEGMENT, 'h-9 px-3')">375px</ToggleGroupItem>
        <ToggleGroupItem value="full" :class="cn(SEGMENTED_SEGMENT, 'h-9 px-3')">Full width</ToggleGroupItem>
      </ToggleGroup>

      <ToggleGroup
        :model-value="colorMode.preference === 'dark' ? 'dark' : 'light'"
        type="single"
        aria-label="Theme"
        :class="SEGMENTED_TRACK"
        @update:model-value="setTheme"
      >
        <ToggleGroupItem value="light" :class="cn(SEGMENTED_SEGMENT, 'h-9 px-3')">Light</ToggleGroupItem>
        <ToggleGroupItem value="dark" :class="cn(SEGMENTED_SEGMENT, 'h-9 px-3')">Dark</ToggleGroupItem>
      </ToggleGroup>
    </div>

    <div
      :class="
        cn(
          'overflow-x-auto rounded-lg border bg-card p-4',
          width === '375' ? 'w-[375px]' : 'w-full',
        )
      "
    >
      <slot />
    </div>
  </div>
</template>
