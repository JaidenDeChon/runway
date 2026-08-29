/**
 * "Rate limiting on auth endpoints" — pinned, rather than asserted in prose.
 *
 * Runway has **no auth endpoint of its own**. The sign-in, sign-up, magic-link
 * and password-reset forms all call GoTrue directly from the browser; nothing
 * under `server/` proxies them. So the rate limit that protects those flows is
 * GoTrue's, configured in `supabase/config.toml` for the local stack and in the
 * dashboard for the hosted project (see `docs/auth.md`, which lists that as a
 * human task).
 *
 * That makes the configuration the control, and configuration that nothing
 * reads is configuration that gets deleted in a cleanup. This file reads it.
 *
 * **Why there is no live probe here.** Exhausting the limit against the local
 * stack is the obvious stronger test, and it is deliberately not written: the
 * limit is per IP over a five-minute window, and every other file in this
 * project — plus the whole E2E suite — signs in. A test that spent the budget
 * would leave the rest of the run failing to authenticate, and the failures
 * would look like authentication bugs rather than like this test. The limit's
 * *behaviour* is GoTrue's to guarantee; its *presence* is ours.
 *
 * Needs no database, in the same spirit as `local-only.test.ts`.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MINIMUM_PASSWORD_LENGTH } from '../../shared/auth/password'

const CONFIG_PATH = fileURLToPath(new URL('../../supabase/config.toml', import.meta.url))
const config = readFileSync(CONFIG_PATH, 'utf8')

/** Reads `key = <number>` from the `[auth.rate_limit]` table. */
function rateLimit(key: string): number | null {
  const table = config.split('[auth.rate_limit]')[1]?.split('\n[')[0] ?? ''
  const match = table.match(new RegExp(`^${key}\\s*=\\s*(\\d+)\\s*$`, 'm'))
  return match?.[1] ? Number(match[1]) : null
}

/** Reads `key = <bool>` from anywhere in the file. */
function flag(key: string): boolean | null {
  const match = config.match(new RegExp(`^${key}\\s*=\\s*(true|false)\\s*$`, 'm'))
  if (!match) return null
  return match[1] === 'true'
}

describe('auth rate limiting is configured', () => {
  it.each([
    // Sign-in and sign-up, per IP per five minutes. The one that matters for
    // credential stuffing.
    ['sign_in_sign_ups', 60],
    // Magic-link and password-reset verification attempts.
    ['token_verifications', 60],
    // Session refreshes. Generous by nature — a busy tab refreshes legitimately.
    ['token_refresh', 300],
  ])('%s is set, and is not effectively unlimited', (key, ceiling) => {
    const value = rateLimit(key)
    expect(value, `[auth.rate_limit] ${key} must be set in supabase/config.toml`).not.toBeNull()
    expect(value).toBeGreaterThan(0)
    // Not a tuning assertion — a "somebody set this to a million" assertion.
    expect(value).toBeLessThanOrEqual(ceiling)
  })

  it('limits outbound email, which is the reset flow’s cost', () => {
    const emailSent = rateLimit('email_sent')
    expect(emailSent).not.toBeNull()
    expect(emailSent).toBeGreaterThan(0)
  })
})

describe('auth configuration the app depends on', () => {
  it('leaves anonymous sign-in off', () => {
    // An anonymous user is a real row in `auth.users` with a real `auth.uid()`,
    // which means RLS would happily give it its own household. Nothing in
    // Runway wants that, and turning it on by accident would be invisible.
    expect(flag('enable_anonymous_sign_ins')).toBe(false)
  })

  it('keeps refresh-token rotation on', () => {
    // Without rotation a leaked refresh token is valid forever.
    expect(flag('enable_refresh_token_rotation')).toBe(true)
  })

  it('points site_url at the loopback dev server, never at a deployed host', () => {
    // `supabase/config.toml` configures the LOCAL stack only. A hosted URL here
    // would send local password-reset links to production.
    const siteUrl = config.match(/^site_url\s*=\s*"([^"]+)"\s*$/m)?.[1] ?? ''
    expect(siteUrl).toMatch(/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/)
  })
})

describe('the password rule the forms promise', () => {
  it('is the rule GoTrue actually enforces', () => {
    // A form promising a looser rule than the auth server enforces produces a
    // rejection the user cannot act on: they typed what they were asked for and
    // were told it is too weak. See shared/auth/password.ts.
    const configured = config.match(/^minimum_password_length\s*=\s*(\d+)\s*$/m)?.[1]
    expect(configured).toBeDefined()
    expect(Number(configured)).toBe(MINIMUM_PASSWORD_LENGTH)
  })
})
