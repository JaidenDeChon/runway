/**
 * Resolves the session once per request, before anything renders.
 *
 * Nuxt route middleware runs during server-side rendering too, and it needs an
 * answer to "who is this?" that does not come from the browser. This is where
 * that answer is produced: one validated `getUser()` per request, cached on
 * `event.context`, which the Nuxt plugin then reads so the very first paint of
 * a protected page is already correct. Without it, every protected page would
 * server-render its signed-out state and correct itself after hydration — a
 * visible flash, and on a money app a misleading one.
 *
 * It also gives `@supabase/ssr` its chance to refresh an access token that is
 * about to expire and write the new one back onto the response. That is what
 * "sessions persist across reload and refresh before expiry" actually rests on.
 *
 * **The anonymous fast path matters.** Nitro middleware runs for every request,
 * including asset requests in dev. A request carrying no auth cookie cannot
 * have a session, so it is answered locally as `null` rather than with a round
 * trip to the auth server.
 *
 * **Nothing here throws.** A misconfigured or unreachable auth server makes a
 * request anonymous, not a 500 — the route middleware then sends the visitor to
 * sign-in, where `requireSupabaseConfig` reports the actual problem once, with
 * the variable to set. Failing on every asset request instead would bury it.
 */

/**
 * `@supabase/ssr` names its cookie `sb-<project-ref>-auth-token`, and chunks it
 * as `.0`, `.1`, … when it is large. Matching on the shape rather than on a
 * reconstructed name keeps this correct if the derivation changes — the library
 * owns that format, and guessing it here is how a fast path becomes a bug that
 * signs everybody out.
 */
function hasAuthCookie(event: Parameters<typeof parseCookies>[0]): boolean {
  return Object.keys(parseCookies(event)).some(
    (name) => name.startsWith('sb-') && name.includes('auth-token'),
  )
}

export default defineEventHandler(async (event) => {
  if (event.context.runwayUser !== undefined) return

  try {
    // Built for every request, and cheap: the client initializes lazily, so
    // this is object construction rather than a round trip.
    // `app/plugins/supabase.server.ts` reads it back off the context, because a
    // plugin in the Vue bundle cannot import a Nitro auto-import.
    serverSupabaseClient(event)

    if (!hasAuthCookie(event)) {
      event.context.runwayUser = null
      return
    }

    await getSessionUser(event)
  } catch {
    event.context.runwayUser = null
  }
})
