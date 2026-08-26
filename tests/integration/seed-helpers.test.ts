/**
 * Issue #5: "Seed utilities create realistic domain fixtures through the same
 * code paths as production."
 *
 * The helper under test is `tests/support/fixtures.ts`. What this file has to
 * establish is not that it inserts rows — that much is obvious the first time
 * it is used — but the three properties that make it worth having:
 *
 * 1. **The fixtures are the domain's own.** The household written here is
 *    `createSeedData()` from `domain/seed.ts`: the same accounts, rules and
 *    transfers the app renders and the design specs quote figures from. A
 *    fixture invented for the test would drift from what the product means by
 *    an account, silently, and every assertion built on it would drift with it.
 *
 * 2. **The writes go through RLS, not around it.** Rows are inserted over a
 *    signed-in user's own session, so seeding is itself an exercise of the
 *    INSERT policies. A helper that seeded over the admin connection could
 *    create rows the application never could, and tests would then be asserting
 *    against a database state that cannot occur in production.
 *
 * 3. **What it creates, it can remove.** A helper that leaks rows turns every
 *    later run into a slightly different experiment.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { occurrenceDates } from '~~/domain/cadence'
import { createSeedData } from '~~/domain/seed'
import { assertCannotReadAnotherUsersRows } from '../support/assertions'
import { secondUserContext, unauthenticatedContext, validUserContext } from '../support/auth'
import { adminSql, LOCAL_STACK } from '../support/database'
import { removeFixtures, type SeededHousehold, seedHousehold } from '../support/fixtures'

const LABEL = 'seedhelp'

/** A window long enough that every cadence in the fixture lands at least once. */
const WINDOW = { start: '2026-09-01', end: '2026-11-30' } as const

const HOUSEHOLD = createSeedData()

describe.skipIf(LOCAL_STACK === null)('the seed helpers', () => {
  let seeded: SeededHousehold

  beforeAll(async () => {
    // Sweep first, so a run that died mid-test last time cannot make this one
    // look like a duplicate-key bug.
    await removeFixtures(LABEL)
    const context = await validUserContext()
    seeded = await seedHousehold(context, {
      label: LABEL,
      accounts: HOUSEHOLD.accounts,
      recurringItems: HOUSEHOLD.recurringItems,
      transfers: HOUSEHOLD.transfers,
      materializeOccurrences: WINDOW,
    })
  })

  afterAll(async () => {
    if (!LOCAL_STACK) return
    await removeFixtures(LABEL)
  })

  it('writes every account, rule and transfer the domain fixture describes', () => {
    expect(seeded.accountIds.size).toBe(HOUSEHOLD.accounts.length)
    expect(seeded.ruleIds.size).toBe(HOUSEHOLD.recurringItems.length)
    expect(seeded.transferIds).toHaveLength(HOUSEHOLD.transfers.length)
    // Not a vacuous fixture — `createSeedData()` is a real household.
    expect(seeded.accountIds.size).toBeGreaterThan(0)
    expect(seeded.ruleIds.size).toBeGreaterThan(0)
  })

  it("materializes occurrences using the engine's own expansion, not its own", () => {
    const expected = HOUSEHOLD.recurringItems.reduce(
      (total, item) => total + occurrenceDates(item, WINDOW.start, WINDOW.end).length,
      0,
    )
    expect(seeded.occurrenceCount).toBe(expected)
    expect(expected).toBeGreaterThan(0)
  })

  it("reads back through the owner's session with the money intact", async () => {
    const context = await validUserContext()
    const result = await context.restSelect('accounts', 'id,name,balance_cents')
    expect(result.status).toBe(200)

    const byName = new Map(result.rows.map((row) => [String(row.name), row]))
    for (const account of HOUSEHOLD.accounts) {
      const row = byName.get(`fixture:${LABEL}:${account.name}`)
      expect(row, `account "${account.name}" should have been seeded`).toBeDefined()
      expect(row?.balance_cents).toBe(account.balance)
    }
  })

  it('creates rows the second user cannot see', async () => {
    const b = await secondUserContext()
    const result = await b.restSelect('accounts', 'id,name,user_id')
    const leaked = result.rows.filter((row) => String(row.name).startsWith(`fixture:${LABEL}:`))
    expect(leaked.map((row) => String(row.name))).toEqual([])

    // And the reusable invariant agrees, over the rows that now exist.
    await expect(assertCannotReadAnotherUsersRows(b, 'accounts')).resolves.toBeGreaterThanOrEqual(0)
  })

  it('refuses to seed for a context that has no user', async () => {
    await expect(
      seedHousehold(unauthenticatedContext(), {
        label: `${LABEL}-anon`,
        accounts: HOUSEHOLD.accounts,
      }),
    ).rejects.toThrow(/no user/)
  })

  it('removes everything it created', async () => {
    await removeFixtures(LABEL)
    const sql = adminSql()
    try {
      const [accounts] = await sql<{ count: string }[]>`
        select count(*)::text as count from public.accounts where name like ${`fixture:${LABEL}:%`}
      `
      const [rules] = await sql<{ count: string }[]>`
        select count(*)::text as count from public.recurring_rules where name like ${`fixture:${LABEL}:%`}
      `
      // Occurrences carry no name of their own; they go with their rule's cascade.
      const [occurrences] = await sql<{ count: string }[]>`
        select count(*)::text as count
        from public.occurrences o
        where not exists (select 1 from public.recurring_rules r where r.id = o.rule_id)
      `
      expect({
        accounts: accounts?.count,
        rules: rules?.count,
        orphanedOccurrences: occurrences?.count,
      }).toEqual({ accounts: '0', rules: '0', orphanedOccurrences: '0' })
    } finally {
      await sql.end()
    }
  })
})
