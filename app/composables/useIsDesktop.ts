/**
 * The app's one breakpoint.
 *
 * Three things fire at it and must agree: the dashboard's two-column grid, the
 * Sheet→Dialog swap in every editor, and the wide container variant. The design
 * treats them as a single "desktop" moment, so the value lives here once rather
 * than being written into each screen — a per-screen literal is how the three
 * quietly drift apart.
 *
 * Matches Tailwind's `lg`, so `lg:` utilities and this composable stay in step.
 */

import { useMediaQuery } from '@vueuse/core'
import { computed, onMounted, ref } from 'vue'

export const DESKTOP_BREAKPOINT_PX = 1024

export function useIsDesktop() {
  const matches = useMediaQuery(`(min-width: ${DESKTOP_BREAKPOINT_PX}px)`)

  // `false` until the client measures. That makes mobile the SSR default, which
  // is the right way round: the mobile layout is the one that survives being
  // shown at the wrong width.
  //
  // The mount gate is what keeps that honest. A media query cannot be evaluated
  // on the server, so without it a desktop client measures `true` during its
  // *first* render and every consumer that switches DOM structure on this value
  // — the Sheet→Dialog swap, the chart's viewBox — renders something the server
  // never sent, which is a hydration mismatch on every desktop page load.
  // Staying `false` through the first client render makes the two agree, and the
  // real value lands immediately after, before paint.
  const isMounted = ref(false)
  onMounted(() => {
    isMounted.value = true
  })

  return computed(() => isMounted.value && matches.value)
}
