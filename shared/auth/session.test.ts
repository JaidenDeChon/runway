/**
 * The session utilities the issue asks for unit tests on.
 *
 * Two of these carry real risk. `isSessionExpired` reads a value in *seconds*
 * that every other clock in JavaScript reports in milliseconds, and getting
 * that wrong produces a session that looks valid for another 48,000 years.
 * `toAuthUser` decides what "signed in" means; if it can return a truthy value
 * for a user with no id, the route middleware lets somebody through.
 */

import { describe, expect, it } from 'vitest'
import {
  authUsersEqual,
  displayNameFor,
  EXPIRY_SKEW_SECONDS,
  initialsFor,
  isSessionExpired,
  toAuthUser,
} from './session'

describe('isSessionExpired', () => {
  const nowMs = Date.UTC(2026, 7, 27, 12, 0, 0)
  const nowSeconds = nowMs / 1000

  it('treats a session expiring well in the future as live', () => {
    expect(isSessionExpired(nowSeconds + 3600, nowMs)).toBe(false)
  })

  it('treats a session that has already expired as expired', () => {
    expect(isSessionExpired(nowSeconds - 1, nowMs)).toBe(true)
  })

  it('expires a session slightly early, to cover clock skew', () => {
    // Inside the skew window: technically still valid, treated as gone, so the
    // app refreshes rather than firing a request that arrives just too late.
    expect(isSessionExpired(nowSeconds + EXPIRY_SKEW_SECONDS - 1, nowMs)).toBe(true)
    expect(isSessionExpired(nowSeconds + EXPIRY_SKEW_SECONDS + 1, nowMs)).toBe(false)
  })

  it('reads expires_at as seconds, not milliseconds', () => {
    // The bug this test exists for: an expiry one hour ago, misread as
    // milliseconds, lands in 1970 — but misreading the *other* way makes an
    // hour-old token look valid until the year 49,000. Passing a
    // millisecond-scaled value must therefore NOT read as live-forever by
    // accident; it does read as live, which is why the units are asserted here
    // rather than left to the caller to remember.
    const millisecondScaled = nowMs
    expect(isSessionExpired(millisecondScaled, nowMs)).toBe(false)
    // The correct, second-scaled equivalent of "expired an hour ago".
    expect(isSessionExpired(nowSeconds - 3600, nowMs)).toBe(true)
  })

  it('treats an unknown expiry as expired rather than as valid', () => {
    expect(isSessionExpired(null, nowMs)).toBe(true)
    expect(isSessionExpired(undefined, nowMs)).toBe(true)
    expect(isSessionExpired(Number.NaN, nowMs)).toBe(true)
    expect(isSessionExpired(Number.POSITIVE_INFINITY, nowMs)).toBe(true)
  })
})

describe('toAuthUser', () => {
  it('narrows a real user', () => {
    const user = toAuthUser({ id: 'abc', email: 'jordan@example.com' })
    expect(user).toEqual({
      id: 'abc',
      email: 'jordan@example.com',
      displayName: 'jordan',
      initials: 'J',
    })
  })

  it('returns null rather than a partially-valid user', () => {
    // Anything falsy here must mean "not signed in" to every caller, because
    // every caller checks `if (!user)`.
    expect(toAuthUser(null)).toBeNull()
    expect(toAuthUser(undefined)).toBeNull()
    expect(toAuthUser({})).toBeNull()
    expect(toAuthUser({ id: '' })).toBeNull()
    expect(toAuthUser({ id: '   ' })).toBeNull()
    expect(toAuthUser({ email: 'jordan@example.com' })).toBeNull()
  })

  it('carries a user with no email address', () => {
    // A user can exist without a confirmed address; that is not a broken user.
    const user = toAuthUser({ id: 'abc' })
    expect(user?.id).toBe('abc')
    expect(user?.email).toBeNull()
    expect(user?.displayName).toBe('Your account')
  })

  it('exposes no token, under any key', () => {
    const user = toAuthUser({
      id: 'abc',
      email: 'jordan@example.com',
      // Whatever else the provider hands over stays out of the app's copy.
      user_metadata: { access_token: 'not-a-real-token', full_name: 'Jordan Rivers' },
    })
    expect(Object.keys(user ?? {}).sort()).toEqual(['displayName', 'email', 'id', 'initials'])
  })
})

describe('authUsersEqual', () => {
  // Regression test for a real defect: `toAuthUser` returns a fresh object
  // literal on every call, so the plugin that assigns `useAuthUser()` from it
  // needs a value comparison rather than `===` — otherwise a caller watching
  // the ref refires on every hydration for a user who has not changed. This
  // is the guard predicate `app/plugins/supabase.client.ts` uses at both of
  // its `user.value` assignment sites.
  it('treats two separately-built objects describing the same user as equal', () => {
    const a = toAuthUser({ id: 'abc', email: 'jordan@example.com' })
    const b = toAuthUser({ id: 'abc', email: 'jordan@example.com' })
    expect(a).not.toBe(b) // different references, same identity
    expect(authUsersEqual(a, b)).toBe(true)
  })

  it('is true for the same null, and false for null against a real user', () => {
    expect(authUsersEqual(null, null)).toBe(true)
    const user = toAuthUser({ id: 'abc' })
    expect(authUsersEqual(user, null)).toBe(false)
    expect(authUsersEqual(null, user)).toBe(false)
  })

  it('is false when any of id, email, displayName or initials differs', () => {
    const base = toAuthUser({ id: 'abc', email: 'jordan@example.com' })
    expect(authUsersEqual(base, toAuthUser({ id: 'xyz', email: 'jordan@example.com' }))).toBe(false)
    expect(authUsersEqual(base, toAuthUser({ id: 'abc', email: 'other@example.com' }))).toBe(false)
    expect(
      authUsersEqual(
        base,
        toAuthUser({
          id: 'abc',
          email: 'jordan@example.com',
          user_metadata: { full_name: 'A Different Name' },
        }),
      ),
    ).toBe(false)
  })
})

describe('displayNameFor', () => {
  it('prefers the name the user supplied', () => {
    expect(displayNameFor({ email: 'a@b.c', user_metadata: { full_name: 'Jordan Rivers' } })).toBe(
      'Jordan Rivers',
    )
    expect(displayNameFor({ email: 'a@b.c', user_metadata: { name: 'Jordan' } })).toBe('Jordan')
  })

  it('falls back to the local part of the email, not the whole address', () => {
    // The sidebar renders the address underneath already; repeating it reads
    // as a bug.
    expect(displayNameFor({ email: 'jordan.rivers@example.com' })).toBe('jordan.rivers')
  })

  it('falls back to a neutral word when there is nothing to use', () => {
    expect(displayNameFor({})).toBe('Your account')
    expect(displayNameFor({ email: '   ' })).toBe('Your account')
    expect(displayNameFor({ user_metadata: { full_name: '   ' }, email: null })).toBe(
      'Your account',
    )
  })
})

describe('initialsFor', () => {
  it('takes the first and last words', () => {
    expect(initialsFor('Jordan Rivers')).toBe('JR')
    expect(initialsFor('Ada Beatrice Lovelace')).toBe('AL')
  })

  it('takes one letter from a single word, not two', () => {
    // "JO" for "Jordan" reads as two people.
    expect(initialsFor('Jordan')).toBe('J')
  })

  it('splits an email local part on its punctuation', () => {
    expect(initialsFor('jordan.rivers')).toBe('JR')
    expect(initialsFor('jordan_rivers')).toBe('JR')
    expect(initialsFor('jordan-rivers')).toBe('JR')
  })

  it('never returns an empty string', () => {
    expect(initialsFor('')).toBe('?')
    expect(initialsFor('   ')).toBe('?')
  })
})
