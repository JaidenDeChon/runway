/**
 * The app's single answer to "who is signed in?", and the actions that change it.
 *
 * Everything downstream — the route middleware, the user menu, and every
 * feature after this one that needs a `user_id` — reads `useAuthUser()`. It is
 * `useState`, so it is filled during server-side rendering from the validated
 * session (see `server/middleware/auth.ts`) and transferred to the client with
 * the payload, which is what makes the first paint of a protected page correct
 * rather than corrected.
 *
 * The Supabase client itself is provided by a plugin — one per request on the
 * server, one per tab in the browser — and reached through `useSupabaseClient()`.
 * Nothing outside `app/plugins/` should construct one.
 */

import type { AuthUser } from '#shared/auth/session'
import type { RunwayClient } from '@/lib/supabase/client'

/** The signed-in user, or `null`. Never write to this outside the auth plugins. */
export function useAuthUser() {
  return useState<AuthUser | null>('runway-auth-user', () => null)
}

/**
 * The Supabase client for the current context.
 *
 * Throws rather than returning `undefined`: a caller that reaches this without
 * a client has a plugin ordering problem, and a silent `undefined` would
 * surface as "cannot read properties of undefined" three frames away.
 */
export function useSupabaseClient(): RunwayClient {
  const client = useNuxtApp().$supabase as RunwayClient | undefined
  if (!client) {
    throw new Error(
      'No Supabase client on this Nuxt app. The usual cause is missing configuration — set ' +
        'NUXT_PUBLIC_SUPABASE_URL and NUXT_PUBLIC_SUPABASE_ANON_KEY, see .env.example. ' +
        'Failing that, check that app/plugins/supabase.{client,server}.ts are registered.',
    )
  }
  return client
}

/** True once the browser plugin has finished its first session check. */
export function useAuthReady() {
  return useState<boolean>('runway-auth-ready', () => import.meta.server)
}
