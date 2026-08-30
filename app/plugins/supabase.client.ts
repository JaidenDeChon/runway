/**
 * Browser-side half of the session.
 *
 * Creates the one Supabase client this tab uses, and keeps `useAuthUser()` in
 * step with it for the tab's whole life. Three things depend on that:
 *
 * - **Refresh.** `supabase-js` renews the access token in the background and
 *   writes it back to the cookie. `TOKEN_REFRESHED` keeps the app's copy of the
 *   user current; a refresh that fails arrives as `SIGNED_OUT`.
 * - **Expiry.** When a session dies — the refresh token expired, or was
 *   revoked — the listener nulls the user and the global route middleware sends
 *   the visitor to sign-in. That is the whole implementation of "an expired
 *   session redirects rather than erroring": there is no error path to take,
 *   because the app's idea of the user is derived from the session rather than
 *   assumed alongside it.
 * - **Other tabs.** Signing out in one tab clears the shared cookie and fires
 *   the event in every other one, so a second tab cannot go on rendering a
 *   dashboard for somebody who has left.
 *
 * `getUser()` runs once at start-up rather than trusting the server-rendered
 * payload forever: the page may have been restored from bfcache, or sat open
 * long enough for the session to die while nothing was navigating.
 *
 * ## Why every assignment to `user.value` is guarded
 *
 * `toAuthUser` returns a fresh object literal on every call, so without a
 * guard `user.value` gets a new reference on *every* hydration even when the
 * signed-in user has not changed — `onAuthStateChange` fires `INITIAL_SESSION`
 * on mount, and the un-awaited `getUser()` below resolves shortly after. A new
 * reference is a change as far as `useRunwayData`'s `watch: [authUser]` is
 * concerned, so each of those two events re-issued the accounts+settings
 * fetch through a freshly constructed client — and if the cookie that client
 * read at construction carried a token already past `exp`, PostgREST rejected
 * it outright with `PGRST303` (no grace period, unlike `getUser()` itself,
 * which tolerates and refreshes). The next auto-refresh recovered on its own,
 * which is what made this look self-healing rather than a bug. `authUsersEqual`
 * closes it: `user.value` is only reassigned when the resolved identity
 * actually differs, so an unchanged user never refires anything watching it.
 */

import { requiresSession, SIGN_IN_PATH } from '#shared/auth/routes'
import { authUsersEqual, toAuthUser } from '#shared/auth/session'
import { requireSupabaseConfig } from '#shared/supabase/config'
import { createRunwayBrowserClient } from '@/lib/supabase/client'

export default defineNuxtPlugin({
  name: 'runway-supabase-client',
  enforce: 'pre',
  setup(nuxtApp) {
    const config = requireSupabaseConfig(useRuntimeConfig().public.supabase)
    const client = createRunwayBrowserClient(config)

    const user = useAuthUser()
    const ready = useAuthReady()

    client.auth.onAuthStateChange((eventName, session) => {
      const next = toAuthUser(session?.user)
      if (!authUsersEqual(user.value, next)) user.value = next
      ready.value = true

      // A session that ends while the visitor is standing on a protected page
      // has to move them; leaving them there would render an empty dashboard
      // and fail on the first write. `router` rather than `navigateTo` because
      // this fires outside a Nuxt context.
      if (!next && eventName === 'SIGNED_OUT') {
        const router = nuxtApp.$router as ReturnType<typeof useRouter>
        const current = router.currentRoute.value
        if (requiresSession(current.path)) {
          router.replace({ path: SIGN_IN_PATH, query: { redirect: current.fullPath } })
        }
      }
    })

    // Not awaited: blocking hydration on a network call would delay first paint
    // for every visitor, and the server-rendered value is already correct for
    // the overwhelming majority of loads. `onAuthStateChange` above fires with
    // `INITIAL_SESSION` once this resolves.
    client.auth
      .getUser()
      .then(({ data, error }) => {
        const next = error ? null : toAuthUser(data.user)
        if (!authUsersEqual(user.value, next)) user.value = next
      })
      .catch(() => {
        if (!authUsersEqual(user.value, null)) user.value = null
      })
      .finally(() => {
        ready.value = true
      })

    return { provide: { supabase: client } }
  },
})
