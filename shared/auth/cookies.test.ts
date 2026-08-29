/**
 * The cookie options, including the flag that is deliberately absent.
 *
 * `httpOnly` not being set is a decision, documented in `cookies.ts` and in
 * `docs/auth.md`. It is asserted here so that turning it on is a red test with
 * a pointer to the reasoning, rather than a one-word change that silently signs
 * every browser out — the browser Supabase client reads these cookies through
 * `document.cookie` in order to refresh the token.
 */

import { describe, expect, it } from 'vitest'
import { authCookieOptions, isSecureOrigin } from './cookies'

describe('authCookieOptions', () => {
  it('scopes the cookie to the whole site and keeps it off cross-site requests', () => {
    const options = authCookieOptions(true)
    expect(options.path).toBe('/')
    expect(options.sameSite).toBe('lax')
  })

  it('marks the cookie secure on https and not on loopback http', () => {
    // `bun run preview` and the E2E suite both serve a production build over
    // http on 127.0.0.1. A `secure` cookie there is one the browser refuses to
    // store, and every authenticated test fails for a reason unrelated to auth.
    expect(authCookieOptions(true).secure).toBe(true)
    expect(authCookieOptions(false).secure).toBe(false)
  })

  it('does not set httpOnly — see the note in cookies.ts before changing this', () => {
    expect(authCookieOptions(true).httpOnly).toBeUndefined()
  })
})

describe('isSecureOrigin', () => {
  it('recognises https', () => {
    expect(isSecureOrigin('https://runway.example')).toBe(true)
    expect(isSecureOrigin('HTTPS://RUNWAY.EXAMPLE')).toBe(true)
  })

  it('does not mistake http, or nothing at all, for https', () => {
    expect(isSecureOrigin('http://127.0.0.1:3000')).toBe(false)
    expect(isSecureOrigin('')).toBe(false)
    expect(isSecureOrigin(null)).toBe(false)
    expect(isSecureOrigin(undefined)).toBe(false)
    // Not a prefix match on the scheme name alone.
    expect(isSecureOrigin('http://https.example')).toBe(false)
  })
})
