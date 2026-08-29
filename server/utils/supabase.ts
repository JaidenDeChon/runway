/**
 * The server's Supabase client, and the session it is allowed to believe.
 *
 * Two things happen here and nowhere else.
 *
 * **A request-scoped client.** `createServerClient` is built per request, over
 * that request's cookies, and cached on `event.context`. Never module-level:
 * a client shared between requests is a session shared between people, which
 * on a financial app is the worst bug available. The cache is per `H3Event`,
 * so it dies with the request.
 *
 * **A validated user, not a decoded one.** `getUser()` asks the auth server
 * whether the token is real; reading the claims out of the JWT locally would
 * trust a string the browser handed us. That distinction is the difference
 * between "server-side session validation" and a decorative check, and it is
 * why `requireUser()` is the only sanctioned way for a handler to learn who is
 * calling. A `user_id` in a query string or a request body is never an input to
 * this — see `docs/auth.md`.
 *
 * The client uses the anon key. It is subject to RLS exactly as the browser is,
 * which is the point: a server handler that forgets to filter by user still
 * cannot read another user's rows, because the policy is evaluated against the
 * session's `auth.uid()`. The service-role key has no reader in this codebase
 * and must not acquire one here.
 */

import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { H3Event } from 'h3'
import { authCookieOptions, isSecureOrigin } from '#shared/auth/cookies'
import { type AuthUser, toAuthUser } from '#shared/auth/session'
import { requireSupabaseConfig } from '#shared/supabase/config'
import type { Database } from '#shared/supabase/database.types'

export type RunwayServerClient = SupabaseClient<Database>

declare module 'h3' {
  interface H3EventContext {
    /** The request-scoped Supabase client. Built lazily by `serverSupabaseClient`. */
    runwaySupabase?: RunwayServerClient
    /**
     * The validated user for this request, or `null` for an anonymous one.
     * `undefined` means the question has not been asked yet.
     */
    runwayUser?: AuthUser | null
  }
}

/** True when the request arrived over https, so the session cookie can be `secure`. */
function requestIsSecure(event: H3Event): boolean {
  const proto = getRequestHeader(event, 'x-forwarded-proto')
  if (proto) return proto.split(',')[0]?.trim().toLowerCase() === 'https'
  return isSecureOrigin(getRequestURL(event).origin)
}

/**
 * The Supabase client for this request, created once and reused.
 *
 * `setAll` writes refreshed tokens back onto the response, which is what keeps
 * a session alive across navigations. Omitting it is the single most common way
 * to produce "random logouts" with `@supabase/ssr`, so it is implemented here
 * rather than left to each caller.
 */
export function serverSupabaseClient(event: H3Event): RunwayServerClient {
  const cached = event.context.runwaySupabase
  if (cached) return cached

  const config = requireSupabaseConfig(useRuntimeConfig(event).public.supabase)
  const cookieOptions = authCookieOptions(requestIsSecure(event))

  const client = createServerClient<Database>(config.url, config.anonKey, {
    cookieOptions,
    cookies: {
      getAll: () => Object.entries(parseCookies(event)).map(([name, value]) => ({ name, value })),
      setAll: (cookiesToSet, headers) => {
        for (const { name, value, options } of cookiesToSet) {
          setCookie(event, name, value, { ...cookieOptions, ...options })
        }
        // The library asks for these when it writes auth cookies. They stop a
        // CDN or reverse proxy caching a response that carries one person's
        // session token and serving it to the next visitor.
        for (const [header, headerValue] of Object.entries(headers)) {
          setResponseHeader(event, header, headerValue)
        }
      },
    },
  })

  event.context.runwaySupabase = client
  return client
}

/**
 * The validated user for this request, or `null`.
 *
 * Resolved at most once per request and cached, because `getUser()` is a call
 * to the auth server and a page render can ask several times.
 *
 * An error is not distinguished from an absent user: an expired token, a
 * tampered one and no token at all all mean the same thing to a caller, and
 * collapsing them here is what makes "expired session redirects rather than
 * erroring" fall out of the ordinary path instead of needing its own branch.
 */
export async function getSessionUser(event: H3Event): Promise<AuthUser | null> {
  if (event.context.runwayUser !== undefined) return event.context.runwayUser

  const client = serverSupabaseClient(event)
  const { data, error } = await client.auth.getUser()
  const user = error ? null : toAuthUser(data.user)

  event.context.runwayUser = user
  return user
}

/**
 * The user, or a 401.
 *
 * The only sanctioned way a handler learns who is calling. Handlers must derive
 * `user_id` from the return value and must never read one from the request.
 */
export async function requireUser(event: H3Event): Promise<AuthUser> {
  const user = await getSessionUser(event)
  if (!user) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      // No detail: whether a token was absent, expired or forged is not the
      // caller's business, and the answer is a probing oracle.
      message: 'Sign in to continue.',
    })
  }
  return user
}
