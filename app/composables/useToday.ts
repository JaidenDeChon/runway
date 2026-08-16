/**
 * Today, as an ISO calendar date, agreed between server and client.
 *
 * Computing `new Date()` independently on both sides is a hydration mismatch
 * waiting for midnight — and for a user whose timezone puts them on a different
 * calendar day from the server, it is a mismatch on every render. Resolving it
 * once through `useState` means the server's answer is serialised into the
 * payload and the client reuses it rather than recomputing.
 */

import type { IsoDate } from '~~/domain/dates'

/** Local calendar date, not UTC — "today" is whatever day the user is having. */
function localToday(): IsoDate {
  const now = new Date()
  const year = now.getFullYear()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function useToday() {
  return useState<IsoDate>('runway-today', localToday)
}
