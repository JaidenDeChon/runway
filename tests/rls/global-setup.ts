/**
 * Resolves the local stack once for the whole `rls` project and hands the
 * details to the test workers through the environment.
 *
 * On a developer machine this deliberately does NOT throw when the stack is
 * down. `bun run test` runs every project, and someone without Docker running
 * should still get a green suite — the RLS files skip themselves and say why.
 *
 * That leniency is exactly wrong in CI, where a skipped suite is
 * indistinguishable from a passing one and the whole point of these tests is
 * that they are the proof. Set `RUNWAY_RLS_REQUIRE_STACK=1` and a missing stack
 * becomes a hard failure instead — see the `database` job in
 * .github/workflows/ci.yml.
 */

import { resolveStack } from './helpers'

const MISSING_STACK = [
  '',
  '  [rls] Local Supabase stack is not running — RLS tests will be SKIPPED.',
  '  [rls] These tests are the proof that the database denies by default;',
  '  [rls] a green run without them proves nothing.',
  '',
  '  [rls] Start it with:  bun run db:start     (requires Docker)',
  '',
].join('\n')

export default function setup(): void {
  const stack = resolveStack()

  if (!stack) {
    if (process.env.RUNWAY_RLS_REQUIRE_STACK === '1') {
      throw new Error(
        'RUNWAY_RLS_REQUIRE_STACK=1 but the local Supabase stack is not reachable. ' +
          'Refusing to skip the RLS suite: skipping it here would report a green run ' +
          'for a database nothing has checked.',
      )
    }
    console.warn(MISSING_STACK)
    return
  }

  process.env.RUNWAY_RLS_API_URL = stack.apiUrl
  process.env.RUNWAY_RLS_DB_URL = stack.dbUrl
  process.env.RUNWAY_RLS_ANON_KEY = stack.anonKey
  process.env.RUNWAY_RLS_SERVICE_ROLE_KEY = stack.serviceRoleKey
}
