/**
 * Acceptance criterion: "integration tests confirm cross-user isolation on
 * every new table," plus the issue's stronger claim — "cross-user access
 * impossible at the data layer, not the application layer."
 *
 * This file is the domain-table companion to `cross-user-isolation.test.ts`,
 * following its two design rules: probe rows are created and torn down over
 * the admin connection, never through a policy-governed client, and
 * assertions are on ownership/database state, never on exact counts or error
 * strings (a `code === '42501'` check would be nice-to-have but is not load
 * bearing — a unique violation on `user_settings` could just as validly win).
 *
 * The last describe block below is the part policies alone cannot prove:
 * composite foreign keys (`docs/database/schema.md`) reject a cross-user
 * reference even over an admin connection that bypasses RLS entirely.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminSql, LOCAL_STACK, signedInClient, USER_A, USER_B } from './helpers'

const PROBE_PREFIX = 'probe:isolation:'

interface ProbeContext {
  readonly userId: string
  readonly account1Id: string
  readonly account2Id: string
  readonly ruleId: string
  readonly occurrenceId: string
  readonly transferId: string
}

interface DomainTableProbe {
  readonly table: 'accounts' | 'recurring_rules' | 'occurrences' | 'transfers' | 'user_settings'
  readonly pk: 'id' | 'user_id'
  /** The row owned by B that A must not reach. */
  readonly probeIdForB: () => string
  /** A row A will try to insert with user_id = B. Must satisfy every FK. */
  readonly plantPayload: () => Record<string, unknown>
  /** A column + sentinel value for the "A cannot update B's row" probe. */
  readonly updateColumn: string
  readonly updateValue: string | number
}

async function removeProbes(): Promise<void> {
  const sql = adminSql()
  try {
    await sql`delete from public.accounts where name like ${`${PROBE_PREFIX}%`}`
  } finally {
    await sql.end()
  }
}

/**
 * One account -> one rule -> one occurrence, plus a second account so a
 * transfer has somewhere to go. Never touches `user_settings` — that table's
 * FK is `on delete set null`, and pointing it at a probe account would mutate
 * seeded settings on teardown.
 */
async function buildProbeChain(
  sql: ReturnType<typeof adminSql>,
  user: typeof USER_A | typeof USER_B,
  label: string,
): Promise<ProbeContext> {
  const [account1] = await sql<{ id: string }[]>`
    insert into public.accounts (user_id, name, color, balance_cents, balance_as_of)
    values (${user.id}, ${`${PROBE_PREFIX}${label}-account-1`}, 'chart-2', 10000, '2026-08-15')
    returning id
  `
  const [account2] = await sql<{ id: string }[]>`
    insert into public.accounts (user_id, name, color, balance_cents, balance_as_of)
    values (${user.id}, ${`${PROBE_PREFIX}${label}-account-2`}, 'chart-3', 20000, '2026-08-15')
    returning id
  `
  if (!account1 || !account2) throw new Error(`could not create probe accounts for ${label}`)

  const [rule] = await sql<{ id: string }[]>`
    insert into public.recurring_rules (user_id, account_id, name, kind, amount_cents, cadence, anchor_date)
    values (${user.id}, ${account1.id}, ${`${PROBE_PREFIX}${label}-rule`}, 'bill', 500, 'monthly', '2026-08-01')
    returning id
  `
  if (!rule) throw new Error(`could not create probe rule for ${label}`)

  const [occurrence] = await sql<{ id: string }[]>`
    insert into public.occurrences (user_id, account_id, rule_id, projected_date, projected_amount_cents)
    values (${user.id}, ${account1.id}, ${rule.id}, '2026-08-01', -500)
    returning id
  `
  if (!occurrence) throw new Error(`could not create probe occurrence for ${label}`)

  const [transfer] = await sql<{ id: string }[]>`
    insert into public.transfers (user_id, from_account_id, to_account_id, amount_cents, occurs_on)
    values (${user.id}, ${account1.id}, ${account2.id}, 250, '2026-08-01')
    returning id
  `
  if (!transfer) throw new Error(`could not create probe transfer for ${label}`)

  return {
    userId: user.id,
    account1Id: account1.id,
    account2Id: account2.id,
    ruleId: rule.id,
    occurrenceId: occurrence.id,
    transferId: transfer.id,
  }
}

let contextA: ProbeContext
let contextB: ProbeContext
/**
 * Widened to un-generic `SupabaseClient` on purpose: `descriptor.table` is a
 * union of table names, and `.from()` on the typed client resolves to a union
 * of query builders that `tsconfig.tests.json`'s strict mode refuses to call.
 * `SupabaseClient` (no type params) accepts `from(relation: string)`.
 */
let api: SupabaseClient

const descriptors: DomainTableProbe[] = [
  {
    table: 'accounts',
    pk: 'id',
    probeIdForB: () => contextB.account1Id,
    plantPayload: () => ({
      user_id: USER_B.id,
      name: `${PROBE_PREFIX}planted`,
      color: 'chart-2',
      balance_cents: 100,
      balance_as_of: '2026-08-15',
    }),
    updateColumn: 'name',
    updateValue: `${PROBE_PREFIX}clobbered-by-a`,
  },
  {
    table: 'recurring_rules',
    pk: 'id',
    probeIdForB: () => contextB.ruleId,
    plantPayload: () => ({
      user_id: USER_B.id,
      account_id: contextB.account1Id,
      name: `${PROBE_PREFIX}planted-rule`,
      kind: 'bill',
      amount_cents: 100,
      cadence: 'monthly',
      anchor_date: '2026-08-01',
    }),
    updateColumn: 'name',
    updateValue: `${PROBE_PREFIX}clobbered-by-a`,
  },
  {
    table: 'occurrences',
    pk: 'id',
    probeIdForB: () => contextB.occurrenceId,
    plantPayload: () => ({
      user_id: USER_B.id,
      account_id: contextB.account1Id,
      rule_id: contextB.ruleId,
      // Distinct from the probe occurrence's own 2026-08-01, so this planted
      // row cannot collide with `occurrences_rule_projected_date_key` and
      // confound which constraint actually rejected the insert.
      projected_date: '2026-08-02',
      projected_amount_cents: -100,
    }),
    updateColumn: 'status',
    updateValue: 'skipped',
  },
  {
    table: 'transfers',
    pk: 'id',
    probeIdForB: () => contextB.transferId,
    plantPayload: () => ({
      user_id: USER_B.id,
      from_account_id: contextB.account1Id,
      to_account_id: contextB.account2Id,
      amount_cents: 999,
      occurs_on: '2026-08-01',
    }),
    updateColumn: 'amount_cents',
    updateValue: 999_999,
  },
  {
    table: 'user_settings',
    pk: 'user_id',
    // The seed creates exactly one settings row per user; the probe must not
    // create a second one, so this points at B's real seeded row.
    probeIdForB: () => USER_B.id,
    plantPayload: () => ({
      user_id: USER_B.id,
      cushion_cents: 1,
      monthly_discretionary_cents: 0,
      default_horizon_days: 30,
    }),
    updateColumn: 'cushion_cents',
    updateValue: 999_999,
  },
]

describe.skipIf(LOCAL_STACK === null)('domain table isolation', () => {
  beforeAll(async () => {
    await removeProbes()
    const sql = adminSql()
    try {
      contextA = await buildProbeChain(sql, USER_A, 'a')
      contextB = await buildProbeChain(sql, USER_B, 'b')
    } finally {
      await sql.end()
    }
    api = (await signedInClient(USER_A)) as unknown as SupabaseClient
  })

  // Runs even after a failed assertion, so a breach cannot leave debris.
  afterAll(async () => {
    if (!LOCAL_STACK) return
    await removeProbes()
  })

  it('guard: every probe row owned by B actually exists, so the assertions below are not vacuous', async () => {
    const sql = adminSql()
    try {
      for (const probe of descriptors) {
        const [row] = await sql<{ count: string }[]>`
          select count(*)::text as count
          from public.${sql(probe.table)}
          where ${sql(probe.pk)} = ${probe.probeIdForB()}
        `
        expect(row?.count, `expected a B-owned row in ${probe.table}`).toBe('1')
      }
    } finally {
      await sql.end()
    }
  })

  for (const probe of descriptors) {
    describe(probe.table, () => {
      it('lets A read only its own rows, and at least one', async () => {
        const columns = probe.pk === 'user_id' ? 'user_id' : `${probe.pk}, user_id`
        const { data, error } = await api.from(probe.table).select(columns)
        expect(error).toBeNull()

        const rows = (data ?? []) as unknown as { id?: string; user_id: string }[]
        expect(rows.length).toBeGreaterThan(0)
        expect(rows.every((row) => row.user_id === USER_A.id)).toBe(true)
      })

      it("hides B's row from A by direct pk lookup", async () => {
        const { data, error } = await api
          .from(probe.table)
          .select(probe.pk)
          .eq(probe.pk, probe.probeIdForB())
        expect(error).toBeNull()
        expect(data ?? []).toHaveLength(0)
      })

      it("will not let A update B's row", async () => {
        const { data: updated } = await api
          .from(probe.table)
          .update({ [probe.updateColumn]: probe.updateValue })
          .eq(probe.pk, probe.probeIdForB())
          .select(probe.pk)

        // The USING clause hides the row from the UPDATE, so it matches
        // nothing rather than erroring.
        expect(updated ?? []).toHaveLength(0)

        // Confirmed over the admin connection: asking a policy-governed
        // client whether the write landed would be asking the mechanism
        // under test.
        const sql = adminSql()
        try {
          const [row] = await sql<Record<string, unknown>[]>`
            select ${sql(probe.updateColumn)} as value
            from public.${sql(probe.table)}
            where ${sql(probe.pk)} = ${probe.probeIdForB()}
          `
          expect(row?.value).not.toBe(probe.updateValue)
        } finally {
          await sql.end()
        }
      })

      it("will not let A delete B's row", async () => {
        await api.from(probe.table).delete().eq(probe.pk, probe.probeIdForB())

        const sql = adminSql()
        try {
          const [row] = await sql<{ count: string }[]>`
            select count(*)::text as count
            from public.${sql(probe.table)}
            where ${sql(probe.pk)} = ${probe.probeIdForB()}
          `
          expect(row?.count).toBe('1')
        } finally {
          await sql.end()
        }
      })

      it('will not let A insert a row owned by B', async () => {
        const { error } = await api.from(probe.table).insert(probe.plantPayload())
        // The WITH CHECK clause rejects this outright — a violation, not a
        // no-op.
        expect(error).not.toBeNull()
      })
    })
  }

  describe('composite foreign keys make a cross-user reference impossible even for an admin connection (BYPASSRLS)', () => {
    it('rejects a recurring_rules row whose account belongs to another user', async () => {
      const sql = adminSql()
      try {
        await expect(
          sql`
            insert into public.recurring_rules (user_id, account_id, name, kind, amount_cents, cadence, anchor_date)
            values (${USER_A.id}, ${contextB.account1Id}, 'cross-user probe', 'bill', 100, 'monthly', '2026-08-01')
          `,
        ).rejects.toThrow(/foreign key/i)
      } finally {
        await sql.end()
      }
    })

    // The date must be one no generated occurrence occupies. On a seeded date the
    // unique index (rule_id, projected_date) raises before the FK is ever checked,
    // so the test would assert on the wrong constraint.
    it("rejects an occurrences row whose rule belongs to another user's account", async () => {
      const sql = adminSql()
      try {
        await expect(
          sql`
            insert into public.occurrences (user_id, account_id, rule_id, projected_date, projected_amount_cents)
            values (${USER_A.id}, ${contextA.account1Id}, ${contextB.ruleId}, '2099-12-15', -100)
          `,
        ).rejects.toThrow(/foreign key/i)
      } finally {
        await sql.end()
      }
    })

    it('rejects a transfers row whose from_account belongs to another user', async () => {
      const sql = adminSql()
      try {
        await expect(
          sql`
            insert into public.transfers (user_id, from_account_id, to_account_id, amount_cents, occurs_on)
            values (${USER_A.id}, ${contextB.account1Id}, ${contextA.account2Id}, 100, '2026-08-01')
          `,
        ).rejects.toThrow(/foreign key/i)
      } finally {
        await sql.end()
      }
    })
  })
})
