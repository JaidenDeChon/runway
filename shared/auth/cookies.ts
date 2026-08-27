/**
 * The cookie the session lives in, and the honest note about `httpOnly`.
 *
 * Issue #6 asks for "auth tokens in httpOnly cookies **where the framework
 * allows**". This is where that qualifier gets cashed out, so nobody has to
 * reconstruct the reasoning from the absence of a flag.
 *
 * `@supabase/ssr` keeps the session in cookies precisely so a server-rendered
 * request can read it — that is the whole reason this app uses cookies rather
 * than `localStorage`, and it is what makes server-side validation possible at
 * all. But the *browser* Supabase client reads the same cookies through
 * `document.cookie` in order to attach the token to its own requests and to
 * refresh it before it expires. Marking them `httpOnly` hides them from that
 * client, and the browser silently loses its session.
 *
 * So the cookies here are `sameSite=lax`, `secure` off loopback, path-scoped —
 * and readable by first-party script, which is the ceiling this architecture
 * has. Raising it means the browser never holding a token at all: every
 * Supabase call proxied through Nitro routes, with the session in a
 * server-only cookie. That is a real option and a real decision — it shapes
 * every data-reading feature after this one — so it is written up in
 * `docs/auth.md` rather than half-taken here.
 *
 * What *is* done in the meantime: the token never reaches a log, a URL, or an
 * analytics event, and `sameSite=lax` keeps it off cross-site requests.
 */

export interface AuthCookieOptions {
  readonly path: string
  readonly sameSite: 'lax'
  readonly secure: boolean
  /**
   * Absent deliberately, and asserted absent by a unit test so that adding it
   * is a decision rather than a copy-paste. See the note above.
   */
  readonly httpOnly?: false
}

/**
 * `secure` is derived from the scheme actually in use rather than from
 * `NODE_ENV`: a production build served over http on loopback (which is exactly
 * what `bun run preview` and the E2E suite do) would otherwise set a cookie the
 * browser refuses to store, and every authenticated test would fail for a
 * reason that has nothing to do with authentication.
 */
export function authCookieOptions(isSecureContext: boolean): AuthCookieOptions {
  return { path: '/', sameSite: 'lax', secure: isSecureContext }
}

/** True when `origin` is served over https. Loopback http is the dev/E2E case. */
export function isSecureOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false
  return origin.toLowerCase().startsWith('https://')
}
