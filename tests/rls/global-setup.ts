/**
 * Resolves the local stack once for the whole `rls` project and hands the
 * details to the test workers through the environment.
 *
 * This deliberately does NOT throw when the stack is down. `bun run test` runs
 * every project, and someone without Docker running should still get a green
 * suite — the RLS files skip themselves and say why. Use `bun run test:rls` to
 * run this project on its own.
 */

import { resolveStack } from './helpers'

export default function setup(): void {
  const stack = resolveStack()

  if (!stack) {
    console.warn(
      [
        '',
        '  [rls] Local Supabase stack is not running — RLS tests will be SKIPPED.',
        '  [rls] These tests are the proof that the database denies by default;',
        '  [rls] a green run without them proves nothing.',
        '',
        '  [rls] Start it with:  bun run db:start     (requires Docker)',
        '',
      ].join('\n'),
    )
    return
  }

  process.env.RUNWAY_RLS_API_URL = stack.apiUrl
  process.env.RUNWAY_RLS_DB_URL = stack.dbUrl
  process.env.RUNWAY_RLS_ANON_KEY = stack.anonKey
  process.env.RUNWAY_RLS_SERVICE_ROLE_KEY = stack.serviceRoleKey
}
