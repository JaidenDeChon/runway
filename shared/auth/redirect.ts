/**
 * Sanitizing the `redirect` hop.
 *
 * Sign-in remembers where the visitor was headed and sends them on afterwards.
 * That value arrives in a query string, which means it arrives from whoever
 * wrote the link — so it is attacker-controlled, and handing it to `navigateTo`
 * unchecked is an open redirect: a link to *our* sign-in page that lands on
 * somebody else's, wearing our domain in the referrer.
 *
 * The rule here is deliberately narrow rather than clever. A destination is
 * allowed only if it is a single absolute path on this origin. Anything that
 * could name another host — a scheme, a protocol-relative `//host`, a
 * backslash, an encoded newline — is not repaired, it is discarded, and the
 * caller falls back to the default landing page.
 */

import { AFTER_SIGN_IN_PATH, normalizeAuthPath, routeAccess } from './routes'

/**
 * `%2f%2fevil.example` and friends: a value can arrive encoded once, and some
 * clients decode before we see it. Decoding first means the checks below see
 * what the browser will eventually see rather than its disguise.
 */
function decodeOnce(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    // A malformed escape is not a path we are going to honour anyway.
    return value
  }
}

/**
 * Returns a same-origin path safe to navigate to, or `null`.
 *
 * `null` means "use the default" — never "navigate to the raw value anyway".
 */
export function sanitizeRedirect(raw: unknown): string | null {
  if (typeof raw !== 'string') return null

  const decoded = decodeOnce(raw.trim())
  if (!decoded) return null

  // Control characters, including the CR/LF that turn a redirect into header
  // injection on some stacks, and the NUL that truncates a string in others.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point — this rejects them.
  if (/[\u0000-\u001f\u007f]/.test(decoded)) return null

  // Backslashes are path separators to several browsers, so `/\evil.example`
  // is a protocol-relative URL wearing a disguise.
  if (decoded.includes('\\')) return null

  // Must be an absolute path on this origin, and must not be protocol-relative.
  if (!decoded.startsWith('/')) return null
  if (decoded.startsWith('//')) return null

  // A scheme cannot appear in a path that starts with `/`, but a second check
  // costs nothing and closes whatever the ones above did not imagine.
  if (/^[a-z][a-z0-9+.-]*:/i.test(decoded)) return null

  return decoded
}

/**
 * Where to send somebody who has just signed in.
 *
 * Falls back to the dashboard both when there is no destination and when the
 * remembered one is itself a sign-in surface — otherwise a visitor who reloaded
 * `/sign-in?redirect=/sign-in` would sign in and arrive back at sign-in.
 */
export function resolvePostSignInPath(raw: unknown): string {
  const safe = sanitizeRedirect(raw)
  if (!safe) return AFTER_SIGN_IN_PATH
  if (routeAccess(normalizeAuthPath(safe)) === 'guest-only') return AFTER_SIGN_IN_PATH
  return safe
}
