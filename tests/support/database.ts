/**
 * Shared plumbing for every suite that speaks to the local database.
 *
 * This was `tests/rls/helpers.ts` and is now one level up, because the RLS
 * suite is no longer the only caller: `tests/integration/` and the Playwright
 * fixtures in `tests/e2e/` need the same seed users, the same clients and the
 * same admin connection. One copy, so "which user is A" can never have two
 * answers.
 *
 * Nothing here hardcodes a URL or a key. Credentials come from
 * `tests/support/stack.ts`, which refuses to resolve anything that is not on
 * this machine.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import type { Database } from '#shared/supabase/database.types'
import { type LocalStack, resolveStack } from './stack'

export type { LocalStack }

export type RunwayTestClient = SupabaseClient<Database>

/**
 * The seed's three synthetic users. Ids are pinned in `supabase/seed.sql`; these
 * constants must agree with that file. Passwords are local-only fixtures with
 * no value outside this machine.
 */
export const USER_A = {
  id: '00000000-0000-4000-8000-00000000000a',
  email: 'user-a@runway.test',
  password: 'runway-local-a',
} as const

export const USER_B = {
  id: '00000000-0000-4000-8000-00000000000b',
  email: 'user-b@runway.test',
  password: 'runway-local-b',
} as const

/**
 * The short household — the one that runs out of money.
 *
 * It mirrors `domain/seed.ts`'s `createShortSeedData()` rather than existing for
 * the isolation probes, which is why the cross-user tests still work in terms of
 * A and B. Sign in as this one to see the app's Short states against real rows.
 */
export const USER_C = {
  id: '00000000-0000-4000-8000-00000000000c',
  email: 'user-c@runway.test',
  password: 'runway-local-c',
} as const

/**
 * The empty household: no accounts, no rules, no transfers. The E2E suite's
 * write target, and the only user whose emptiness is a fixture.
 */
export const USER_D = {
  id: '00000000-0000-4000-8000-00000000000d',
  email: 'user-d@runway.test',
  password: 'runway-local-d',
} as const

export type SeedUser = typeof USER_A | typeof USER_B | typeof USER_C | typeof USER_D

/**
 * Resolved once at module load. `null` when the local stack is not running,
 * which is what the test files branch on to skip themselves.
 */
export const LOCAL_STACK = resolveStack()

/**
 * The stack, narrowed to non-null.
 *
 * Safe to call anywhere inside a `describe.skipIf(LOCAL_STACK === null)` block:
 * the throw is unreachable there. It exists so no caller needs a non-null
 * assertion, and so a mistake surfaces as a readable message rather than
 * "cannot read properties of null".
 */
export function requireStack(): LocalStack {
  if (!LOCAL_STACK) {
    throw new Error('local Supabase stack is not running — start it with `bun run db:start`')
  }
  return LOCAL_STACK
}

/** A client carrying no session at all — the unauthenticated public. */
export function anonClient(): RunwayTestClient {
  const stack = requireStack()
  return createClient<Database>(stack.apiUrl, stack.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

/** A client authenticated as one of the seed users. */
export async function signedInClient(user: SeedUser): Promise<RunwayTestClient> {
  const client = anonClient()
  const { data, error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  })
  if (error) throw new Error(`could not sign in as ${user.email}: ${error.message}`)
  if (data.user?.id !== user.id) {
    throw new Error(`signed in as ${data.user?.id}, expected ${user.id} — is the seed stale?`)
  }
  return client
}

/**
 * The access token for a seed user, as GoTrue actually issues it.
 *
 * The E2E harness needs the token itself rather than a client wrapped around
 * it, so it can hand a browser a session the app will find already present.
 */
export async function signedInSession(user: SeedUser): Promise<{
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: number
  readonly userId: string
}> {
  const client = anonClient()
  const { data, error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  })
  if (error || !data.session) {
    throw new Error(
      `could not sign in as ${user.email}: ${error?.message ?? 'no session returned'}`,
    )
  }
  return {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at ?? 0,
    userId: data.user?.id ?? '',
  }
}

/**
 * A direct superuser connection, for asserting catalog state and for the
 * negative control's policy surgery. `postgres` holds BYPASSRLS, so this
 * deliberately sees everything — never use it to assert an isolation property.
 */
export function adminSql() {
  return postgres(requireStack().dbUrl, { max: 1, onnotice: () => {} })
}

const ROLLBACK = Symbol('rollback')

/**
 * Runs `fn` inside a transaction that is ALWAYS rolled back, with the
 * connection acting as `authenticated` for `userId` — the role and JWT claim
 * that RLS actually reads.
 *
 * This exists because a filtered write cannot test an UPDATE or DELETE policy.
 * PostgreSQL applies SELECT policies *in addition* to UPDATE/DELETE ones
 * whenever the statement references relation columns, so `PATCH ...?id=eq.X`
 * matches zero rows via the SELECT policy and the write policy is never
 * reached. Only an unfiltered statement reaches it — and an unfiltered
 * statement would clobber the caller's own rows, hence the rollback.
 *
 * `asAdmin()` drops back to the superuser inside the same transaction so a
 * test can assert what the write did without asking the mechanism under test.
 */
export async function asUserInRolledBackTx<T>(
  userId: string,
  fn: (
    tx: postgres.TransactionSql,
    asAdmin: () => Promise<void>,
    asAuthenticated: () => Promise<void>,
  ) => Promise<T>,
): Promise<T> {
  const sql = adminSql()
  let result: T | undefined
  try {
    await sql.begin(async (tx) => {
      const asAuthenticated = async () => {
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({
          sub: userId,
          role: 'authenticated',
        })}, true)`
        await tx`select set_config('role', 'authenticated', true)`
      }
      const asAdmin = async () => {
        await tx`select set_config('role', 'postgres', true)`
      }
      await asAuthenticated()
      result = await fn(tx as postgres.TransactionSql, asAdmin, asAuthenticated)
      // Nothing this helper does is allowed to survive.
      throw ROLLBACK
    })
  } catch (err) {
    if (err !== ROLLBACK) throw err
  } finally {
    await sql.end()
  }
  return result as T
}

/** Every domain table, in an order that is safe to delete from front to back. */
export const DOMAIN_TABLES = [
  'occurrences',
  'transfers',
  'recurring_rules',
  'user_settings',
  'accounts',
] as const

export type DomainTable = (typeof DOMAIN_TABLES)[number]
