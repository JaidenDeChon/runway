/**
 * Server-side half of the session: publish what the Nitro middleware already
 * validated, and hand the render the same request-scoped client.
 *
 * No second `getUser()` call and no second client — `server/middleware/auth.ts`
 * did both, once, for this request, and left them on `event.context`. Deriving
 * them again here would double the auth-server traffic and, worse, let the two
 * halves of one render disagree about who is signed in.
 *
 * Reading `event.context` rather than importing the server util is not a
 * stylistic choice: `server/utils/` is auto-imported into Nitro, and a Nuxt
 * plugin — even a `.server.ts` one — is part of the Vue bundle, which does not
 * see those. The request context is the seam the two halves share.
 */

import { requireSupabaseConfig } from '#shared/supabase/config'
import type { RunwayClient } from '@/lib/supabase/client'

export default defineNuxtPlugin({
  name: 'runway-supabase-server',
  // Before route middleware runs, so the first navigation already knows.
  enforce: 'pre',
  setup() {
    const event = useRequestEvent()
    const user = useAuthUser()
    const ready = useAuthReady()

    // `event` is absent when Nuxt pre-renders a route at build time. There is
    // no request and therefore no session; anonymous is the correct answer.
    user.value = event?.context.runwayUser ?? null
    ready.value = true

    const client = event?.context.runwaySupabase
    if (client) return { provide: { supabase: client as RunwayClient } }

    // No client on the context means the middleware could not build one, and
    // by far the likeliest reason is that Supabase is not configured at all.
    // Re-deriving the config here converts a confusing "no Supabase client on
    // this Nuxt app" into an error that names the two environment variables to
    // set. It rethrows deliberately: an app that cannot reach Supabase cannot
    // sign anybody in, and rendering a sign-in form that will never work is
    // worse than failing at boot.
    if (event) requireSupabaseConfig(useRuntimeConfig().public.supabase)
  },
})
