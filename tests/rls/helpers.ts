/**
 * Shared plumbing for the live-database RLS suite.
 *
 * Nothing here hardcodes a URL or a key. Credentials come from
 * `supabase status -o json` at run time, which means this suite cannot
 * accidentally be pointed at the hosted project: `supabase status` only ever
 * describes the local stack, and it fails outright when the stack is down.
 */

import { execFileSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import type { Database } from '#shared/supabase/database.types'

export interface LocalStack {
  readonly apiUrl: string
  readonly dbUrl: string
  readonly anonKey: string
  readonly serviceRoleKey: string
}

/**
 * The seed's two synthetic users. Ids are pinned in `supabase/seed.sql`; these
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

/** The fixture table the suite exercises. Not a domain table — see issue #3. */
export const FIXTURE_TABLE = 'rls_fixture_items'

let cached: LocalStack | null | undefined

/**
 * Resolve the local stack's connection details, or `null` when it is not up.
 *
 * `global-setup.ts` populates the `RUNWAY_RLS_*` variables once so each test
 * file does not pay for its own `supabase status` subprocess; the direct call
 * is the fallback for when that did not happen (a single file run through the
 * IDE, for instance).
 */
export function resolveStack(): LocalStack | null {
  if (cached !== undefined) return cached

  const fromEnv = process.env.RUNWAY_RLS_API_URL
  if (fromEnv) {
    cached = {
      apiUrl: fromEnv,
      dbUrl: process.env.RUNWAY_RLS_DB_URL as string,
      anonKey: process.env.RUNWAY_RLS_ANON_KEY as string,
      serviceRoleKey: process.env.RUNWAY_RLS_SERVICE_ROLE_KEY as string,
    }
    return cached
  }

  try {
    const raw = execFileSync('supabase', ['status', '-o', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const status = JSON.parse(raw) as Record<string, string>
    // ANON_KEY is the legacy JWT; PUBLISHABLE_KEY is its replacement. Newer CLI
    // versions may stop emitting the former, so accept either.
    const anonKey = status.ANON_KEY || status.PUBLISHABLE_KEY
    const serviceRoleKey = status.SERVICE_ROLE_KEY || status.SECRET_KEY
    if (!status.API_URL || !status.DB_URL || !anonKey || !serviceRoleKey) {
      cached = null
      return cached
    }
    cached = {
      apiUrl: status.API_URL,
      dbUrl: status.DB_URL,
      anonKey,
      serviceRoleKey,
    }
  } catch {
    cached = null
  }
  return cached
}

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
export function anonClient(): SupabaseClient<Database> {
  const stack = requireStack()
  return createClient<Database>(stack.apiUrl, stack.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

/** A client authenticated as one of the seed users. */
export async function signedInClient(
  user: typeof USER_A | typeof USER_B,
): Promise<SupabaseClient<Database>> {
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
 * A direct superuser connection, for asserting catalog state and for the
 * negative control's policy surgery. `postgres` holds BYPASSRLS, so this
 * deliberately sees everything — never use it to assert an isolation property.
 */
export function adminSql() {
  return postgres(requireStack().dbUrl, { max: 1, onnotice: () => {} })
}

/**
 * The suite's core isolation assertion, factored out so `negative-control`
 * can prove it actually fails when the policy is widened.
 *
 * Throws when user A can see any row it does not own. Returns the number of
 * rows A legitimately sees.
 */
export async function assertUserAOnlySeesOwnRows(): Promise<number> {
  const client = await signedInClient(USER_A)
  const { data, error } = await client.from(FIXTURE_TABLE).select('id, user_id')
  if (error) throw new Error(`user A could not read its own rows: ${error.message}`)

  const rows = data ?? []
  const foreign = rows.filter((row) => row.user_id !== USER_A.id)
  if (foreign.length > 0) {
    throw new Error(
      `RLS BREACH: user A can see ${foreign.length} row(s) owned by another user ` +
        `(ids: ${foreign.map((r) => r.id).join(', ')})`,
    )
  }
  return rows.length
}
