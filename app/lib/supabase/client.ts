import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '#shared/supabase/database.types'

/** The Supabase client, typed against the committed schema in shared/supabase/. */
export type RunwayClient = SupabaseClient<Database>

export interface RunwaySupabaseConfig {
  readonly url: string
  readonly anonKey: string
}

/**
 * Build a browser-side Supabase client.
 *
 * Config is passed in rather than read from `useRuntimeConfig()` so this module
 * stays framework-free and testable. Callers in Nuxt code pass
 * `useRuntimeConfig().public.supabase` directly.
 *
 * This uses the anon/publishable key only. The service-role key bypasses every
 * RLS policy and must never be handed to this function.
 */
export function createRunwayClient(config: RunwaySupabaseConfig): RunwayClient {
  return createClient<Database>(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
}
