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

export const DESKTOP_BREAKPOINT_PX = 1024

export function useIsDesktop() {
  // `false` until the client measures. That makes mobile the SSR default, which
  // is the right way round: the mobile layout is the one that survives being
  // shown at the wrong width.
  return useMediaQuery(`(min-width: ${DESKTOP_BREAKPOINT_PX}px)`)
}
