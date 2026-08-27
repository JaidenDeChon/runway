/**
 * RLS-suite-specific helpers.
 *
 * The general plumbing — seed users, clients, the admin connection, the
 * rolled-back transaction — moved to `tests/support/database.ts` when issue #5
 * gave `tests/integration/` and `tests/e2e/` the same needs. It is re-exported
 * here so the files in this directory read exactly as they did, and so there is
 * still one obvious import for anything RLS.
 *
 * What stays here is what only the RLS suite has an opinion about: the fixture
 * table, and the isolation assertion the negative control has to be able to
 * make fail.
 */

export {
  adminSql,
  anonClient,
  asUserInRolledBackTx,
  LOCAL_STACK,
  type LocalStack,
  type RunwayTestClient,
  requireStack,
  type SeedUser,
  signedInClient,
  USER_A,
  USER_B,
  USER_C,
} from '../support/database'
export { resolveStack } from '../support/stack'

import { signedInClient, USER_A } from '../support/database'

/**
 * The fixture table the suite exercises. Not a domain table — issue #3 kept it
 * deliberately: the negative control needs a table whose policies can be
 * loosened and restored mid-suite, and doing that to a real domain table like
 * `accounts` would mean mutating its policy set while other assertions run
 * against it. See docs/database/schema.md for the decision.
 */
export const FIXTURE_TABLE = 'rls_fixture_items'

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
