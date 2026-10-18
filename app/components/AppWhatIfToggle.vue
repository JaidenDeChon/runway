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
 * **The whole pill is the hit target.** It is a `<label>` dressed as an outline
 * button, wrapping the registry `Switch`: a click anywhere on the mark, the
 * word or the track flips it, while the `Switch` stays the one focusable,
 * announced control (`role="switch"`, named "What-if mode"). A real `<button>`
 * around it would nest one button inside another, which is invalid HTML and
 * leaves a screen reader with two controls for one state. The focus ring is
 * drawn on the pill (`has-focus-visible:`) so keyboard focus looks like the
 * thing you are pressing.
 *
 * **Text, not colour alone.** `--chart-5` is the what-if token everywhere on
 * this screen, but the label says "What-if" and the switch reports its own
 * on/off state; the amber is the third telling, never the only one. The mark
 * (a dashed square around a question mark, `WhatIfMark`, the same mark
 * the what-if bar, banners and Upcoming hint carry) is `aria-hidden` — a
 * visual anchor for the mode, not information.
 *
 * At 375px the word drops and the mark stays, which keeps the control inside
 * a header that also holds the wordmark, the sidebar trigger, the breadcrumb
 * and the theme button. The switch's accessible name is unaffected: it comes
 * from `aria-label`, which says "What-if mode" at every width.
 */

import { buttonVariants } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import WhatIfMark from '@/components/WhatIfMark.vue'
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
  <label
    :class="
      cn(
        buttonVariants({ variant: 'outline', size: 'sm' }),
        'cursor-pointer gap-2 has-focus-visible:border-ring has-focus-visible:ring-3 has-focus-visible:ring-ring/50',
        on ? 'border-chart-5 text-chart-5 hover:text-chart-5' : 'text-muted-foreground',
      )
    "
    data-slot="what-if-toggle"
  >
    <WhatIfMark class="size-4" />
    <span class="hidden sm:inline">What-if</span>
    <Switch
      :model-value="on"
      size="sm"
      aria-label="What-if mode"
      :class="cn('shrink-0 after:hidden', on && 'data-checked:bg-chart-5')"
      @update:model-value="(value) => setWhatIf(value === true)"
    />
  </label>
</template>
