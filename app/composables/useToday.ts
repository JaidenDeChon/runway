/**
 * Today, as an ISO calendar date, in the user's timezone.
 *
 * Two things have to be true at once, and the old implementation managed
 * neither. The date has to be the *user's* — a server in `us-east-1` renders
 * "today" for a reader in Auckland who is already on tomorrow — and server and
 * client have to agree on it, or every render after midnight is a hydration
 * mismatch.
 *
 * So the instant is resolved once, on the server, and serialised into the
 * payload; the zone comes from `useTimeZone`, which is UTC until the browser
 * reports otherwise. Both halves are then handed to `todayIn`, which is the
 * only function in the domain that knows what a timezone is.
 *
 * The zone corrects itself on mount, so a reader whose device disagrees with
 * UTC about the date sees it settle to their day immediately after hydration.
 * That is a re-render, not a mismatch — the server and the client agree on what
 * they rendered, and then the client learns something the server could not know.
 */

import { useTimeZone } from '@/composables/useTimeZone'
import type { IsoDate } from '~~/domain/dates'
import { todayIn } from '~~/domain/dates'

export function useToday() {
  const timeZone = useTimeZone()
  // The instant, not the date. Resolved on the server and carried across, so
  // the two runtimes are reading the same moment in the same zone.
  const at = useState<number>('runway-now', () => Date.now())

  return computed<IsoDate>(() => todayIn(timeZone.value, at.value))
}
