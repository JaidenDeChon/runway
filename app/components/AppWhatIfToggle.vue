<script setup lang="ts">
/**
 * The what-if switch in the app header, on the dashboard only.
 *
 * Issue #16 put what-if behind the day editor's switch, which meant the mode
 * could only be entered from inside a modal, on a day that already had
 * something on it. Everything the mode is *for* — reading the chart, the
 * verdict and the Upcoming list under a hypothetical — happens with that modal
 * closed, so the control that starts it belongs where the screen is, not
 * inside a sheet you have to close to see the answer.
 *
 * **It renders only on `/`.** What-if previews the dashboard's projection;
 * there is nothing for it to change on `/accounts` or `/recurring-items`, and
 * a switch that does nothing on three screens out of four is worse than no
 * switch. The layout decides that — see `app/layouts/default.vue` — so this
 * component stays about the control itself.
 *
 * The day editor keeps its own switch. Two controls for one state is
 * deliberate rather than an oversight: the editor is modal, so while it is
 * open this one is unreachable, and somebody who opened a day to change a
 * figure should not have to close it to ask "what if". They share
 * `useWhatIf()`, so they cannot disagree, and both route their off-switch
 * through the same confirmation.
 *
 * **Text, not colour alone.** `--chart-5` is the what-if token everywhere on
 * this screen, but the label says "What-if" and the switch reports its own
 * on/off state; the amber is the third telling, never the only one. The ◑
 * glyph is the same mark the bar and the editor's banner carry, and is
 * `aria-hidden` — it is a visual anchor for the mode, not information.
 *
 * At 375px the word drops and the glyph stays, which keeps the control inside
 * a header that also holds the sidebar trigger, the breadcrumb, the wordmark
 * and the theme button. The switch's accessible name is unaffected: it comes
 * from `aria-label`, which says "What-if mode" at every width.
 */
import { Switch } from '@/components/ui/switch'
import { useWhatIf } from '@/composables/useWhatIf'
import { cn } from '@/lib/utils'

const whatIf = useWhatIf()
/** Pulled out so the template reads a top-level ref, which Vue unwraps for it. */
const on = whatIf.on

/**
 * On goes straight through; off asks first, and only when there is something
 * to lose. `requestExit` owns both halves of that — the page renders the
 * dialog it opens.
 */
function setWhatIf(value: boolean): void {
  if (value) {
    whatIf.set(true)
    return
  }
  whatIf.requestExit()
}
</script>

<template>
  <div
    class="flex shrink-0 items-center gap-1.5 rounded-4xl border border-dashed px-2 py-1 transition-colors"
    :class="on ? 'border-chart-5' : 'border-transparent'"
    data-slot="what-if-toggle"
  >
    <span
      aria-hidden="true"
      :class="cn('text-sm', on ? 'text-chart-5' : 'text-muted-foreground')"
    >
      ◑
    </span>
    <span
      :class="
        cn(
          'hidden text-sm font-medium sm:inline',
          on ? 'text-chart-5' : 'text-muted-foreground',
        )
      "
    >
      What-if
    </span>
    <Switch
      :model-value="on"
      aria-label="What-if mode"
      :class="cn('shrink-0', on && 'data-checked:bg-chart-5')"
      @update:model-value="(value) => setWhatIf(value === true)"
    />
  </div>
</template>
