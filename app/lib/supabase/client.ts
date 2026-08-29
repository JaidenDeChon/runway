import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { authCookieOptions, isSecureOrigin } from '#shared/auth/cookies'
import type { RunwaySupabaseConfig } from '#shared/supabase/config'
import type { Database } from '#shared/supabase/database.types'

/** The Supabase client, typed against the committed schema in shared/supabase/. */
export type RunwayClient = SupabaseClient<Database>

export type { RunwaySupabaseConfig }

/**
 * Build the browser-side Supabase client.
 *
 * Config is passed in rather than read from `useRuntimeConfig()` so this module
 * stays framework-free and testable. The caller in Nuxt code is
 * `app/plugins/supabase.client.ts`, which reads
 * `useRuntimeConfig().public.supabase` and validates it once.
 *
 * **Cookies, not `localStorage`.** `createBrowserClient` persists the session in
 * cookies, which is what lets a server-rendered request see it: route
 * protection, `requireUser()` in a Nitro handler, and the user menu on first
 * paint all read the same session the browser holds. `@supabase/supabase-js`'s
 * plain `createClient` would put it in `localStorage`, where the server can
 * never see it, and every protected page would flash its signed-out state
 * before the client caught up. See `#shared/auth/cookies` for why those cookies
 * are not `httpOnly`.
 *
 * This uses the anon/publishable key only. The service-role key bypasses every
 * RLS policy and must never reach anything under `app/`.
 */
export function createRunwayBrowserClient(config: RunwaySupabaseConfig): RunwayClient {
  const secure = isSecureOrigin(
    typeof window === 'undefined' ? null : (window.location?.origin ?? null),
  )

  return createBrowserClient<Database>(config.url, config.anonKey, {
    cookieOptions: authCookieOptions(secure),
    auth: {
      // A magic link and a password-reset link both come back as a `code` in
      // the query string. The *server* route at /auth/confirm exchanges it, so
      // the browser client must not race it for the same single-use code.
      detectSessionInUrl: false,
      flowType: 'pkce',
      autoRefreshToken: true,
      persistSession: true,
    },
  })
}
