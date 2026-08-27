/**
 * The route classification, and the one property that matters about it: a route
 * nobody thought about is protected.
 *
 * The failure mode this guards against is not a wrong answer for `/sign-in`.
 * It is issue #15 adding `/occurrences`, nobody adding it to a list, and the
 * page being readable without a session — which is exactly what a default of
 * `public` would produce.
 */

import { describe, expect, it } from 'vitest'
import { navGroups } from '../../app/lib/navigation'
import { normalizeAuthPath, requiresSession, routeAccess, SIGN_IN_PATH } from './routes'

describe('routeAccess', () => {
  it('protects a route it has never heard of', () => {
    expect(routeAccess('/some-screen-nobody-has-built-yet')).toBe('protected')
    expect(routeAccess('/')).toBe('protected')
  })

  it('protects every route in the app navigation', () => {
    // Ties the two lists together: a nav entry added without thought is
    // protected, and this test says so out loud rather than trusting the
    // default to stay the default.
    for (const group of navGroups) {
      for (const item of group.items) {
        expect(requiresSession(item.path), `${item.path} must require a session`).toBe(true)
      }
    }
  })

  it('leaves the sign-in surfaces open to guests only', () => {
    expect(routeAccess(SIGN_IN_PATH)).toBe('guest-only')
    expect(routeAccess('/sign-up')).toBe('guest-only')
    expect(routeAccess('/forgot-password')).toBe('guest-only')
  })

  it('leaves the emailed-link surfaces open to everybody', () => {
    // `/reset-password` in particular: the visitor arrives *authenticated* by a
    // recovery session, and `guest-only` would bounce them to the dashboard one
    // step short of setting the password they came for.
    expect(routeAccess('/reset-password')).toBe('public')
    expect(routeAccess('/auth/confirm')).toBe('public')
    expect(routeAccess('/auth/error')).toBe('public')
  })

  it('classifies a trailing slash the same as no trailing slash', () => {
    expect(routeAccess('/sign-in/')).toBe('guest-only')
    expect(routeAccess('/reset-password/')).toBe('public')
  })

  it('is not fooled by a query string or a fragment', () => {
    expect(routeAccess('/sign-in?redirect=/accounts')).toBe('guest-only')
    expect(routeAccess('/reset-password#token')).toBe('public')
    // And the reverse: a protected path with a query is still protected.
    expect(routeAccess('/accounts?sort=name')).toBe('protected')
  })
})

describe('normalizeAuthPath', () => {
  it('leaves the root alone', () => {
    expect(normalizeAuthPath('/')).toBe('/')
  })

  it('strips one trailing slash', () => {
    expect(normalizeAuthPath('/accounts/')).toBe('/accounts')
  })

  it('drops the query and the fragment', () => {
    expect(normalizeAuthPath('/accounts?a=1#b')).toBe('/accounts')
  })

  it('answers with the root for an empty path', () => {
    expect(normalizeAuthPath('')).toBe('/')
  })
})
