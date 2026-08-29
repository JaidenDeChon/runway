/**
 * The door on every route.
 *
 * Global rather than opt-in, and the classification lives in
 * `#shared/auth/routes`, so adding a page protects it. A per-page
 * `definePageMeta({ middleware: 'auth' })` would put the same decision in every
 * new file and make forgetting it look like nothing at all.
 *
 * This runs during server-side rendering as well as in the browser, reading the
 * same `useAuthUser()` state — filled on the server from a validated session,
 * not from anything the client claimed. So an unauthenticated request for a
 * protected page is redirected before its HTML is built, rather than being
 * rendered and then hidden.
 *
 * Route protection is a *usability* boundary, not the security boundary. The
 * security boundary is RLS plus `requireUser()`: a visitor who defeats this
 * middleware reaches a page that can read nothing.
 */

import { resolvePostSignInPath } from '#shared/auth/redirect'
import { routeAccess, SIGN_IN_PATH } from '#shared/auth/routes'

export default defineNuxtRouteMiddleware((to) => {
  const user = useAuthUser()
  const access = routeAccess(to.path)

  if (access === 'public') return

  if (access === 'guest-only') {
    // Offering sign-in to somebody already signed in is a dead end, so send
    // them where they were going. `/reset-password` is deliberately `public`
    // rather than `guest-only` for this reason: the visitor there *is*
    // authenticated, by a recovery session, and bouncing them would strand
    // them one step short of the password they came to set.
    if (user.value) return navigateTo(resolvePostSignInPath(to.query.redirect))
    return
  }

  if (!user.value) {
    return navigateTo({
      path: SIGN_IN_PATH,
      // `fullPath`, so a visitor deep-linked to a filtered view comes back to
      // that view rather than to its bare path.
      query: { redirect: to.fullPath },
    })
  }
})
