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
  authErrorResult,
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

describe('authErrorResult', () => {
  // Issue #89: this file got the words right and still leaked, because the
  // *tone* a caller rendered them in was computed separately and stayed
  // 'error' even when the words were the neutral acknowledgement. These tests
  // are what goes red if that gap reopens.
  it('gives a masked password-reset failure the same tone the success path uses', () => {
    const result = authErrorResult('password-reset-request', { code: 'user_not_found' })
    expect(result.message).toBe(NEUTRAL_EMAIL_SENT)
    expect(result.tone).toBe('notice')
    // Not a routine code — an unregistered address never reaches this branch
    // at all (GoTrue attempts no delivery for one, so no error comes back),
    // so a masked password-reset failure that *does* occur is, by
    // elimination, a real delivery problem and stays loggable.
    expect(result.loggable).toBe(true)
  })

  it('gives a masked magic-link failure the same tone the success path uses', () => {
    const result = authErrorResult('magic-link', { code: 'user_not_found' })
    expect(result.message).toBe(NEUTRAL_EMAIL_SENT)
    expect(result.tone).toBe('notice')
  })

  it('gives a masked sign-up failure the same tone the success path uses, but does not treat it as loggable', () => {
    // The exact shape GoTrue returns locally for an address that already has
    // an account, with email confirmations off — verified directly against
    // the local stack (see useAuthActions.ts signUp). Ordinary behaviour,
    // not an incident, so `loggable` is false — the case
    // `ROUTINE_MASKED_CODES`/`useAuthActions.ts`'s `failed()` exists for.
    const result = authErrorResult('sign-up', {
      message: 'User already registered',
      code: 'user_already_exists',
      status: 422,
    })
    expect(result.message).toBe(NEUTRAL_SIGN_UP_SENT)
    expect(result.tone).toBe('notice')
    expect(result.loggable).toBe(false)
  })

  it('treats every other masked sign-up failure as loggable', () => {
    // The routine exclusion is narrow on purpose — anything that is not
    // confirmed-routine defaults to loggable, including one that might
    // eventually turn out to need its own exclusion. Under-logging a real
    // incident is the worse failure mode of the two.
    const result = authErrorResult('sign-up', { code: 'unexpected_failure' })
    expect(result.message).toBe(NEUTRAL_SIGN_UP_SENT)
    expect(result.tone).toBe('notice')
    expect(result.loggable).toBe(true)
  })

  it('is loggable for a masked failure with no code at all', () => {
    const result = authErrorResult('sign-up', {})
    expect(result.tone).toBe('notice')
    expect(result.loggable).toBe(true)
  })

  it('does not neutralise the tone for an operation the masking never applies to', () => {
    // sign-in's own conflation (rule at line 65 above) is a message concern,
    // not a tone one — an invalid-credentials failure is still a failure.
    const result = authErrorResult('sign-in', { code: 'invalid_credentials' })
    expect(result.tone).toBe('error')
  })

  it('keeps rate limiting an error, on every operation the masking applies to', () => {
    // The one deliberate exception, carried through from authErrorMessage: a
    // fact about this browser, not about any account, so hiding it would be
    // the wrong kind of quiet.
    for (const operation of ['sign-up', 'magic-link', 'password-reset-request'] as const) {
      const result = authErrorResult(operation, { code: 'over_email_send_rate_limit' })
      expect(result.tone, `${operation} rate limit`).toBe('error')
      expect(result.message, `${operation} rate limit`).toMatch(/too many/i)
    }
  })

  it("does not neutralise a message this operation's masking never produces", () => {
    // Guards the check itself: tone must follow what the message *is*, not
    // what operation was asked for. sign-in never falls through to either
    // neutral constant, so a coincidental match should not exist to test —
    // asserted here so a future refactor that starts comparing operations
    // instead of messages gets caught rather than silently over-matching.
    const result = authErrorResult('sign-in', {})
    expect(result.message).not.toBe(NEUTRAL_EMAIL_SENT)
    expect(result.message).not.toBe(NEUTRAL_SIGN_UP_SENT)
    expect(result.tone).toBe('error')
  })
})
