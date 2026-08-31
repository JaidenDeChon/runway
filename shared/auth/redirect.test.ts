/**
 * The open-redirect guard, tested as the security control it is.
 *
 * Each case below is a payload that has worked against a real application at
 * some point. They are grouped by the trick rather than by the function, so a
 * future reader can see what class of attack each rule is closing rather than
 * only that a string returns null.
 */

import { describe, expect, it } from 'vitest'
import { resolvePostSignInPath, sanitizeRedirect } from './redirect'
import { AFTER_SIGN_IN_PATH } from './routes'

describe('sanitizeRedirect', () => {
  it('keeps an ordinary same-origin path', () => {
    expect(sanitizeRedirect('/accounts')).toBe('/accounts')
    expect(sanitizeRedirect('/')).toBe('/')
  })

  it('keeps the query and fragment of a deep link', () => {
    expect(sanitizeRedirect('/will-i-make-it?horizon=60')).toBe('/will-i-make-it?horizon=60')
    expect(sanitizeRedirect('/accounts#savings')).toBe('/accounts#savings')
  })

  describe('rejects anything that could name another host', () => {
    // The whole point: a link to *our* sign-in that lands on somebody else's.
    it.each([
      ['an absolute http url', 'http://evil.example/steal'],
      ['an absolute https url', 'https://evil.example/steal'],
      ['a protocol-relative url', '//evil.example/steal'],
      ['a javascript: url', 'javascript:alert(1)'],
      ['a data: url', 'data:text/html,<script>alert(1)</script>'],
      ['a backslash-disguised host', '/\\evil.example'],
      ['a double-backslash host', '\\\\evil.example'],
    ])('%s', (_label, payload) => {
      expect(sanitizeRedirect(payload)).toBeNull()
    })

    it('sees through a single layer of percent-encoding', () => {
      // Some clients decode before navigating, so `%2F%2F` becomes `//`.
      expect(sanitizeRedirect('%2F%2Fevil.example')).toBeNull()
      expect(sanitizeRedirect('%68ttp://evil.example')).toBeNull()
    })
  })

  describe('rejects control characters', () => {
    it('strips nothing and rejects the whole value', () => {
      expect(sanitizeRedirect('/accounts\nLocation: https://evil.example')).toBeNull()
      expect(sanitizeRedirect('/accounts\r\nSet-Cookie: a=b')).toBeNull()
      expect(sanitizeRedirect('/accounts\u0000.png')).toBeNull()
    })
  })

  describe('rejects anything that is not a path at all', () => {
    it.each([
      ['a relative path', 'accounts'],
      ['an empty string', ''],
      ['whitespace only', '   '],
      ['a number', 42],
      ['null', null],
      ['undefined', undefined],
      ['an array, as a repeated query parameter arrives', ['/a', '/b']],
    ])('%s', (_label, payload) => {
      expect(sanitizeRedirect(payload)).toBeNull()
    })
  })
})

describe('resolvePostSignInPath', () => {
  it('honours a safe destination', () => {
    expect(resolvePostSignInPath('/accounts')).toBe('/accounts')
  })

  it('falls back to the dashboard when there is nothing to honour', () => {
    expect(resolvePostSignInPath(undefined)).toBe(AFTER_SIGN_IN_PATH)
    expect(resolvePostSignInPath('https://evil.example')).toBe(AFTER_SIGN_IN_PATH)
  })

  it('refuses to send a freshly signed-in user back to sign-in', () => {
    // `/sign-in?redirect=/sign-in` is what a reload of the sign-in page
    // produces. Honouring it would loop.
    expect(resolvePostSignInPath('/sign-in')).toBe(AFTER_SIGN_IN_PATH)
    expect(resolvePostSignInPath('/sign-up')).toBe(AFTER_SIGN_IN_PATH)
    expect(resolvePostSignInPath('/forgot-password')).toBe(AFTER_SIGN_IN_PATH)
  })

  it('does honour the password-reset screen, which is not guest-only', () => {
    // A recovery link carries `next=/reset-password` and the visitor arrives
    // authenticated. Treating it like the other auth screens would strand them.
    expect(resolvePostSignInPath('/reset-password')).toBe('/reset-password')
  })
})
