import type { Ref } from 'vue'
import { onMounted, ref, watch } from 'vue'
import type { ChartDensity } from '@/lib/burndown'
import { DEFAULT_DENSITY, normalizeDensity } from '@/lib/burndown'

/**
 * Chart density, remembered in the browser between visits.
 *
 * This stays device-local by decision, not because sign-in never landed —
 * every route is behind a Supabase session now. `CLAUDE.md` puts the
 * browser's timezone, viewport and colour-scheme preference in one category:
 * device-derived facts, re-derived on each device rather than carried as user
 * data. Density is a cosmetic judgment about *this screen on this device* in
 * the same way, which is the case for leaving it here. Whether a signed-in
 * user would actually expect it to follow them to a second device — which
 * would mean moving it to `user_settings` — is a live question, not a closed
 * one, and is deferred to a follow-up issue (#72) rather than decided
 * silently in either direction.
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
