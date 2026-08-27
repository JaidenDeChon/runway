/**
 * The enumeration guard.
 *
 * "Error messages state what went wrong without revealing whether an email is
 * registered" is a security property, and a security property that only exists
 * in a code comment is a security property that a well-meaning "let's show the
 * real error, it's more helpful" pull request deletes. These tests are the
 * thing that goes red when it does.
 */

import { describe, expect, it } from 'vitest'
import {
  authErrorMessage,
  NEUTRAL_EMAIL_SENT,
  NEUTRAL_SIGN_UP_SENT,
  revealsRegistration,
} from './errors'

describe('revealsRegistration', () => {
  it('recognises the provider messages that name an account', () => {
    expect(revealsRegistration('User already registered')).toBe(true)
    expect(revealsRegistration('A user with this email address has already been registered')).toBe(
      true,
    )
    expect(revealsRegistration('Email address is already in use')).toBe(true)
  })

  it('does not flag messages about the request itself', () => {
    expect(revealsRegistration('Invalid login credentials')).toBe(false)
    expect(revealsRegistration('Password should be at least 6 characters')).toBe(false)
    expect(revealsRegistration(undefined)).toBe(false)
  })
})

describe('authErrorMessage', () => {
  it('never returns a provider message verbatim', () => {
    // The specific leak: sign-up told to say "already registered" must not.
    const message = authErrorMessage('sign-up', {
      message: 'User already registered',
      code: 'user_already_exists',
      status: 422,
    })
    expect(message).toBe(NEUTRAL_SIGN_UP_SENT)
    expect(revealsRegistration(message)).toBe(false)
  })

  it('gives sign-up the same answer whatever went wrong', () => {
    const alreadyRegistered = authErrorMessage('sign-up', { code: 'user_already_exists' })
    const somethingElse = authErrorMessage('sign-up', { code: 'unexpected_failure' })
    const nothingInParticular = authErrorMessage('sign-up', {})
    expect(alreadyRegistered).toBe(NEUTRAL_SIGN_UP_SENT)
    expect(somethingElse).toBe(NEUTRAL_SIGN_UP_SENT)
    expect(nothingInParticular).toBe(NEUTRAL_SIGN_UP_SENT)
  })

  it('gives a reset request and a magic link the same answer whatever went wrong', () => {
    // An unregistered address must be indistinguishable from a registered one.
    expect(authErrorMessage('password-reset-request', { code: 'user_not_found' })).toBe(
      NEUTRAL_EMAIL_SENT,
    )
    expect(authErrorMessage('magic-link', { code: 'user_not_found' })).toBe(NEUTRAL_EMAIL_SENT)
    expect(authErrorMessage('magic-link', {})).toBe(NEUTRAL_EMAIL_SENT)
  })

  it('conflates "no such user" and "wrong password" on sign-in', () => {
    // GoTrue already returns one code for both. This keeps our copy singular
    // too, so the *message* cannot become the oracle the *code* refused to be.
    const message = authErrorMessage('sign-in', { code: 'invalid_credentials' })
    expect(message).toMatch(/email and password do not match/i)
    expect(message).not.toMatch(/account|registered|exists|found/i)
  })

  it('surfaces rate limiting, because it is a fact about this browser', () => {
    // The one deliberate exception. Hiding it leaves somebody pressing a dead
    // button, and it says nothing about any account.
    expect(authErrorMessage('sign-up', { code: 'over_email_send_rate_limit' })).toMatch(/too many/i)
    expect(authErrorMessage('password-reset-request', { status: 429 })).toMatch(/too many/i)
    expect(authErrorMessage('sign-in', { code: 'over_request_rate_limit' })).toMatch(/too many/i)
  })

  it('reflects the codes that describe the request rather than the account', () => {
    expect(authErrorMessage('password-update', { code: 'weak_password' })).toMatch(/too weak/i)
    expect(authErrorMessage('password-update', { code: 'same_password' })).toMatch(
      /already your password/i,
    )
    expect(authErrorMessage('sign-in', { code: 'otp_expired' })).toMatch(/expired/i)
  })

  it('falls back to a generic message for a code it has never seen', () => {
    const message = authErrorMessage('sign-in', {
      code: 'some_new_code_from_a_future_gotrue',
      message: 'A user with this email address has already been registered',
    })
    expect(revealsRegistration(message)).toBe(false)
    expect(message).toMatch(/something went wrong/i)
  })

  it('handles a missing error without throwing', () => {
    expect(authErrorMessage('sign-out', null)).toMatch(/something went wrong/i)
    expect(authErrorMessage('sign-out', undefined)).toMatch(/something went wrong/i)
  })
})
