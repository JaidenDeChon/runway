<script setup lang="ts">
/**
 * The what-if mode indicator — fixed to the viewport, so the mode is
 * unmistakable at every scroll position (issue #16).
 *
 * The chart card already carries a dashed `--chart-5` outline and a banner,
 * but both scroll away, and issue #16 asks for an affordance that does not.
 * That requirement only became meaningful once what-if outlived the day
 * editor: while the mode was editor-scoped the page behind it was a modal's
 * inert backdrop and could not be scrolled at all. See `index.vue` for that
 * change and the spec deviation it carries.
 *
 * **Fixed rather than sticky.** `position: sticky` resolves against the
 * nearest scroll container, and this page sits inside `SidebarInset`'s flex
 * column; fixed answers to the viewport and cannot be defeated by an
 * ancestor's overflow. The bar is `pointer-events-none` so it never eats a
 * click meant for the chart beneath it, with the pill itself restoring
 * pointer events for its own button.
 *
 * **Text, not colour alone.** `--chart-5` is the what-if token everywhere on
 * this screen (docs/design/dashboard/spec.md § Colour), but colour is not a
 * status: the bar says what is happening and how much is at stake, following
 * `OccurrenceRow`'s "Edited" badge rather than relying on the amber.
 *
 * Deliberately not a live region. The switch that turns the mode on already
 * announces its own state, and `app/app.vue`'s `<NuxtRouteAnnouncer>` holds
 * the page's one `role="status"` — a second would make both harder to
 * address, which `tests/guards/announcer-role-collisions.test.ts` exists to
 * prevent.
 */
import { Button } from '@/components/ui/button'
import { previewSummary } from '@/lib/what-if'

const props = defineProps<{ editCount: number }>()
const emit = defineEmits<{ exit: [] }>()

const summary = computed(() => previewSummary(props.editCount))
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center p-4"
    data-slot="what-if-bar"
  >
    <div
      class="pointer-events-auto flex w-full max-w-[560px] items-center gap-3 rounded-lg border border-dashed border-chart-5 bg-chart-5/10 px-3 py-2 shadow-lg backdrop-blur-sm"
    >
      <span aria-hidden="true" class="text-chart-5">◑</span>
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium text-chart-5">What-if preview — not saved</p>
        <p class="truncate text-xs text-muted-foreground">{{ summary }}</p>
      </div>
      <Button type="button" variant="outline" size="sm" class="shrink-0" @click="emit('exit')">
        Exit what-if
      </Button>
    </div>
  </div>
</template>
