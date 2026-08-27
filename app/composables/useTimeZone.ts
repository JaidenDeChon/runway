/**
 * The IANA timezone the user's calendar days are measured in.
 *
 * Two sources, in order: an explicit override the user stored, then the device.
 * `null` in storage — the default — means "follow whatever device I'm on",
 * which is what almost everybody wants: "what day is it" should follow the
 * phone in your hand, not a setting you forgot you changed.
 *
 * **The device half is deliberately not stored.** A resolved zone is a fact
 * about a device, and writing it into the user's data would freeze the first
 * device they happened to open the app on — a laptop opened once in another
 * country would keep answering with that country's dates forever. What the user
 * *chose* is data; what the browser reports is not. Keeping those apart is what
 * makes an account behave correctly on a second device later.
 *
 * On the server there is no device, so the fallback is UTC rather than the
 * deploy region's zone. Rendering in the region's zone is the bug this exists to
 * remove: the server sits in one place and the user does not.
 */

import { useRunwayData } from '@/composables/useRunwayData'

/** UTC, not the host's zone: a server has no business having an opinion here. */
export const FALLBACK_TIME_ZONE = 'UTC'

/**
 * What the browser reports, or `null` when there is no browser or it refuses.
 *
 * `resolvedOptions().timeZone` is well supported but is allowed to return an
 * empty string, and a locked-down environment can throw, so neither outcome is
 * assumed.
 */
export function deviceTimeZone(): string | null {
  if (!import.meta.client) return null
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

/**
 * What the device reported, once it has been asked.
 *
 * `useState` so the server's `null` is serialised into the payload and the
 * client renders the same thing the server did. `plugins/device-time-zone.client.ts`
 * fills it in on `app:mounted` — after hydration, deliberately, so learning the
 * zone is a re-render rather than a mismatch.
 */
export function useDeviceTimeZone() {
  return useState<string | null>('runway-device-time-zone', () => null)
}

/** The zone to measure calendar days in: the user's override, else the device, else UTC. */
export function useTimeZone() {
  const { timeZoneOverride } = useRunwayData()
  const device = useDeviceTimeZone()
  return computed(() => timeZoneOverride.value ?? device.value ?? FALLBACK_TIME_ZONE)
}
