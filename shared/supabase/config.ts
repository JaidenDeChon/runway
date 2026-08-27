/**
 * The public Supabase configuration, and the one place it is checked.
 *
 * `nuxt.config.ts` declares `runtimeConfig.public.supabase` with empty-string
 * defaults so nothing is baked into the build — the real values arrive from the
 * environment at runtime, which is what lets Netlify change them without a
 * redeploy. The cost of that is that "not configured" looks exactly like
 * "configured with an empty string", and an empty string handed to
 * `createClient` fails much later, somewhere unhelpful.
 *
 * So the check happens once, here, on the way out of runtime config, and the
 * error names the environment variable to set. No value is ever interpolated
 * into the message: the anon key is public by design, but a habit of printing
 * credentials is not something to establish in the module every other module
 * calls.
 */

export interface RunwaySupabaseConfig {
  readonly url: string
  readonly anonKey: string
}

export class SupabaseNotConfiguredError extends Error {
  constructor(missing: readonly string[]) {
    super(
      `Supabase is not configured: ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} empty. ` +
        'Set NUXT_PUBLIC_SUPABASE_URL and NUXT_PUBLIC_SUPABASE_ANON_KEY — see .env.example.',
    )
    this.name = 'SupabaseNotConfiguredError'
  }
}

/**
 * Narrows loosely-typed runtime config into a usable pair, or throws.
 *
 * Throws rather than returning `null` because there is no sensible degraded
 * mode: an app that cannot reach Supabase cannot sign anybody in, and a page
 * that renders a dead sign-in form is worse than one that fails loudly at boot.
 */
export function requireSupabaseConfig(raw: {
  readonly url?: string
  readonly anonKey?: string
}): RunwaySupabaseConfig {
  const url = raw.url?.trim() ?? ''
  const anonKey = raw.anonKey?.trim() ?? ''

  const missing: string[] = []
  if (!url) missing.push('NUXT_PUBLIC_SUPABASE_URL')
  if (!anonKey) missing.push('NUXT_PUBLIC_SUPABASE_ANON_KEY')
  if (missing.length > 0) throw new SupabaseNotConfiguredError(missing)

  return { url, anonKey }
}
