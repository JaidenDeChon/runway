/**
 * Issue #5: "Auth helpers support: valid user, second user, unauthenticated,
 * expired session."
 *
 * This is the file that proves those four helpers describe four genuinely
 * different callers, rather than four names for the same request. Each one is
 * asked the same question of the same table, and the answers have to differ in
 * the ways the security model says they should.
 *
 * Two of the acceptance criteria live here as well — cross-user read denial and
 * unauthenticated denial — asserted through the reusable invariants in
 * `tests/support/assertions.ts` rather than inline, so the same assertion
 * objects the RLS negative control can be pointed at.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import {
  assertCannotReadAnotherUsersRows,
  assertUnauthenticatedReadsNothing,
} from '../support/assertions'
import {
  type AuthContext,
  expiredSessionContext,
  secondUserContext,
  unauthenticatedContext,
  validUserContext,
} from '../support/auth'
import { DOMAIN_TABLES, LOCAL_STACK, USER_A, USER_B } from '../support/database'
import { describeSecretAvailability } from '../support/jwt'

describe.skipIf(LOCAL_STACK === null)('auth contexts', () => {
  describe('a valid user', () => {
    it('reads its own rows, and only its own', async () => {
      const context = await validUserContext()
      expect(context.userId).toBe(USER_A.id)

      const visible = await assertCannotReadAnotherUsersRows(context, 'accounts')
      // Not vacuous: "sees nothing at all" would pass an isolation check for
      // entirely the wrong reason, and is what a stale seed looks like.
      expect(visible).toBeGreaterThan(0)
    })
  })

  describe('a second user', () => {
    it('is a different user, with its own rows', async () => {
      const context = await secondUserContext()
      expect(context.userId).toBe(USER_B.id)
      expect(context.userId).not.toBe(USER_A.id)

      const visible = await assertCannotReadAnotherUsersRows(context, 'accounts')
      expect(visible).toBeGreaterThan(0)
    })

    it('shares no row with the first user, on any domain table', async () => {
      const a = await validUserContext()
      const b = await secondUserContext()

      for (const table of DOMAIN_TABLES) {
        const seenByA = await a.restSelect(table, 'id,user_id')
        const seenByB = await b.restSelect(table, 'id,user_id')
        expect(seenByA.status).toBe(200)
        expect(seenByB.status).toBe(200)

        const idsForA = new Set(seenByA.rows.map((row) => String(row.id)))
        const overlap = seenByB.rows.filter((row) => idsForA.has(String(row.id)))
        expect(overlap.map((row) => String(row.id))).toEqual([])
      }
    })
  })

  describe('an unauthenticated caller', () => {
    it('reads nothing from any domain table', async () => {
      const anonymous = unauthenticatedContext()
      for (const table of DOMAIN_TABLES) {
        await expect(assertUnauthenticatedReadsNothing(anonymous, table)).resolves.toBeUndefined()
      }
    })

    it('has no user of its own', () => {
      expect(unauthenticatedContext().userId).toBeNull()
    })
  })

  describe('an expired session', () => {
    let context: AuthContext

    beforeAll(async () => {
      const resolved = await expiredSessionContext()
      if (!resolved) {
        // Never silently downgraded to a weaker assertion: a malformed token is
        // rejected by a different code path than an expired one, so asserting
        // on a malformed token here would be a different test wearing this
        // test's name. And never skipped, because "we could not test the
        // expired-session helper" must not read as "the expired-session helper
        // works".
        throw new Error(
          'Could not mint an expired token for the local stack, so the expired-session ' +
            `context is untestable in this environment (${describeSecretAvailability()}). ` +
            'Fix the secret resolution in tests/support/jwt.ts rather than weakening this test.',
        )
      }
      context = resolved
    })

    it('is refused, and refused for being expired', async () => {
      const result = await context.restSelect('accounts', 'id')

      expect(result.status).toBe(401)
      expect(result.rows).toEqual([])
      // PostgREST's code for a JWT it will not accept. Asserted by code rather
      // than by message text, which moves between versions.
      expect(result.code).toBe('PGRST301')
    })

    it('is refused on every domain table, not just the one', async () => {
      for (const table of DOMAIN_TABLES) {
        const result = await context.restSelect(table, 'id')
        expect({ table, status: result.status, rows: result.rows.length }).toEqual({
          table,
          status: 401,
          rows: 0,
        })
      }
    })
  })

  describe('the four contexts', () => {
    it('are genuinely distinct callers', async () => {
      const contexts: AuthContext[] = [
        await validUserContext(),
        await secondUserContext(),
        unauthenticatedContext(),
      ]
      const expired = await expiredSessionContext()
      if (expired) contexts.push(expired)

      const names = contexts.map((context) => context.name)
      expect(new Set(names).size).toBe(names.length)

      // The two signed-in ones must not be the same person.
      const userIds = contexts.map((context) => context.userId).filter((id) => id !== null)
      expect(new Set(userIds).size).toBeGreaterThanOrEqual(2)
    })
  })
})
