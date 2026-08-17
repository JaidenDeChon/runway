import type { Ref } from 'vue'
import { onMounted, ref, watch } from 'vue'
import type { ChartDensity } from '@/lib/burndown'
import { DEFAULT_DENSITY, normalizeDensity } from '@/lib/burndown'

/**
 * Chart density, remembered in the browser between visits.
 *
 * This is the signed-out path, and currently the only one — the app has no auth
 * yet (`AppUserMenu` is presentational). When accounts land, a signed-in user's
 * density should come from their profile and this should stay as the fallback
 * for anonymous visitors; the call site swaps, the storage helpers below do not.
 *
 * Only presentation numbers are written — never balances, per the repo's rule
 * about what may leave the app.
 */

const STORAGE_KEY = 'runway.chart-density'

function readStored(): ChartDensity | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw === null ? null : normalizeDensity(JSON.parse(raw))
  } catch {
    // Unreadable, unparseable, or storage denied outright. Any of those just
    // means "no stored preference"; the default covers it.
    return null
  }
}

function writeStored(value: ChartDensity): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Storage can be unavailable in private mode or with site data blocked.
    // This setting is cosmetic, so a failed write is not worth surfacing.
  }
}

export function useChartDensity(): Ref<ChartDensity> {
  // Starts at the default so the server and the client's first render agree.
  // Reading storage during setup would render different geometry than the
  // server sent and trip a hydration mismatch on every load.
  const density = ref<ChartDensity>(DEFAULT_DENSITY)

  onMounted(() => {
    const stored = readStored()
    if (stored) density.value = stored

    // Watched only after the restore, so rehydrating a stored value does not
    // immediately write it back.
    watch(density, writeStored, { deep: true })
  })

  return density
}
