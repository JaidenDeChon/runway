/**
 * Where every emailed link lands: magic link, sign-up confirmation, password
 * recovery, email change.
 *
 * **A server route, not a page.** The exchange writes the session cookie, and
 * doing it here means the cookie is set by the response that redirects onward —
 * so the very next request is already authenticated and nothing renders in
 * between. A client-side exchange would flash the signed-out state and, worse,
 * would have to run before the route middleware that guards the destination.
 *
 * **Two shapes, because email links come in two.**
 *
 * - `?token_hash=…&type=…` — Supabase's recommended form. Survives being
 *   opened on a different device from the one that asked, because there is no
 *   PKCE verifier to match. It requires the project's email templates to use
 *   `{{ .TokenHash }}`; see `docs/auth.md` for the template change, which is a
 *   dashboard action on the hosted project.
 * - `?code=…` — what the **default** templates produce. Exchanged against the
 *   PKCE verifier the browser stored when it requested the link, so it works
 *   only in the browser that asked. Supported so the feature works before
 *   anybody touches the templates.
 *
 * Both are single-use and short-lived; that is GoTrue's property, not ours, and
 * it is what "password reset tokens single-use and expiring" rests on.
 *
 * A failure never explains itself in the URL. The visitor goes to
 * `/auth/error`, which offers them the way to ask for a fresh link — an error
 * string in a query parameter is both an XSS sink and a hint to whoever sent
 * the link.
 */

import type { EmailOtpType } from '@supabase/supabase-js'
import { sanitizeRedirect } from '#shared/auth/redirect'
import { AFTER_SIGN_IN_PATH } from '#shared/auth/routes'

/**
 * The OTP types an emailed link may legitimately carry. An unrecognised `type`
 * is rejected rather than passed through: it is a value from the URL, and
 * `verifyOtp` takes it as an instruction.
 */
const ALLOWED_OTP_TYPES = new Set<EmailOtpType>([
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
])

function isAllowedOtpType(value: string | undefined): value is EmailOtpType {
  return !!value && ALLOWED_OTP_TYPES.has(value as EmailOtpType)
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const client = serverSupabaseClient(event)

  const tokenHash = typeof query.token_hash === 'string' ? query.token_hash : undefined
  const type = typeof query.type === 'string' ? query.type : undefined
  const code = typeof query.code === 'string' ? query.code : undefined

  // Recovery is the one type with a mandatory next step: the visitor has a
  // session, but only so they can set a password. Everything else lands where
  // it was headed.
  const fallback = type === 'recovery' ? '/reset-password' : AFTER_SIGN_IN_PATH
  const next = sanitizeRedirect(query.next) ?? fallback

  if (tokenHash && isAllowedOtpType(type)) {
    const { error } = await client.auth.verifyOtp({ token_hash: tokenHash, type })
    if (!error) return sendRedirect(event, next)
    return sendRedirect(event, '/auth/error')
  }

  if (code) {
    const { error } = await client.auth.exchangeCodeForSession(code)
    if (!error) return sendRedirect(event, next)
    return sendRedirect(event, '/auth/error')
  }

  return sendRedirect(event, '/auth/error')
})
