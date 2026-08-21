/**
 * Structural constraints that are not policies.
 *
 * `domain-tables.test.ts` proves who may touch a row; this file proves what a
 * row is allowed to say. Both matter for the same reason — an invariant a
 * reader has to remember is not an invariant — but these hold against an admin
 * connection with BYPASSRLS, which is the whole point of putting them in the
 * database instead of in a form handler.
 *
 * Every test runs inside a transaction that is always rolled back, so the suite
 * leaves the seed exactly as it found it and can be run repeatedly.
 */

import type postgres from 'postgres'
import { describe, expect, it } from 'vitest'
import { adminSql, LOCAL_STACK, USER_A } from './helpers'

/** PostgreSQL `check_violation`. Asserted by code, never by message text. */
const CHECK_VIOLATION = '23514'

const ROLLBACK = Symbol('rollback')

async function withRollback<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  const sql = adminSql()
  let result: T | undefined
  try {
    await sql.begin(async (tx) => {
      result = await fn(tx as postgres.TransactionSql)
      throw ROLLBACK
    })
  } catch (err) {
    if (err !== ROLLBACK) throw err
  } finally {
    await sql.end()
  }
  return result as T
}

/** A throwaway account for user A to hang rules off. Disappears with the rollback. */
async function probeAccount(tx: postgres.TransactionSql): Promise<string> {
  const [account] = await tx<{ id: string }[]>`
    insert into public.accounts (user_id, name, color, balance_cents, balance_as_of)
    values (${USER_A.id}, 'probe:constraints:account', 'chart-2', 10000, '2026-08-15')
    returning id
  `
  if (!account) throw new Error('could not create the probe account')
  return account.id
}

/**
 * Inserts a rule with whatever day columns the caller names.
 * `days` is spliced in as raw SQL so a test can pass `null`, `'{}'`, or a
 * deliberately malformed literal without postgres.js inferring a type for it.
 */
async function insertRule(
  tx: postgres.TransactionSql,
  accountId: string,
  cadence: string,
  column: 'days_of_month' | 'days_of_week',
  days: string,
) {
  return tx<{ days_of_month: number[] | null; days_of_week: number[] | null }[]>`
    insert into public.recurring_rules (
      user_id, account_id, name, kind, amount_cents, cadence, anchor_date, ${tx(column)}
    )
    values (
      ${USER_A.id}, ${accountId}, 'probe:constraints:rule', 'bill', 500,
      ${cadence}::public.recurring_cadence, '2026-08-01', ${tx.unsafe(days)}
    )
    returning days_of_month, days_of_week
  `
}

describe.skipIf(LOCAL_STACK === null)('recurring_rules day sets', () => {
  it('accepts a semi-monthly rule, stored sorted and de-duplicated', async () => {
    const rows = await withRollback(async (tx) => {
      const accountId = await probeAccount(tx)
      return insertRule(tx, accountId, 'monthly', 'days_of_month', `'{15,1,15}'`)
    })
    // The normalising trigger, not the caller, decides the stored order — so
    // {15,1} and {1,15} are one value rather than two rules that look different.
    expect(rows[0]?.days_of_month?.map(Number)).toEqual([1, 15])
  })

  it('accepts -1 alongside real days, as month end', async () => {
    const rows = await withRollback(async (tx) => {
      const accountId = await probeAccount(tx)
      return insertRule(tx, accountId, 'monthly', 'days_of_month', `'{-1,1}'`)
    })
    expect(rows[0]?.days_of_month?.map(Number)).toEqual([-1, 1])
  })

  it('accepts weekday sets on weekly rules, likewise normalised', async () => {
    const rows = await withRollback(async (tx) => {
      const accountId = await probeAccount(tx)
      return insertRule(tx, accountId, 'weekly', 'days_of_week', `'{4,1,4}'`)
    })
    expect(rows[0]?.days_of_week?.map(Number)).toEqual([1, 4])
  })

  it('normalises on update, not only on insert', async () => {
    const rows = await withRollback(async (tx) => {
      const accountId = await probeAccount(tx)
      await insertRule(tx, accountId, 'monthly', 'days_of_month', `'{1,15}'`)
      return tx<{ days_of_month: number[] }[]>`
        update public.recurring_rules
        set days_of_month = '{28,5,5}'
        where name = 'probe:constraints:rule'
        returning days_of_month
      `
    })
    expect(rows[0]?.days_of_month?.map(Number)).toEqual([5, 28])
  })

  it('rejects the empty day set rather than reading it as "the anchor day"', async () => {
    // The trap this guards: array_length('{}', 1) is null, and a check
    // constraint whose expression is null passes. Written with cardinality
    // instead — if that ever regresses, this test is what notices.
    await expect(
      withRollback(async (tx) => {
        const accountId = await probeAccount(tx)
        return insertRule(tx, accountId, 'monthly', 'days_of_month', `'{}'`)
      }),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('rejects a day no month has', async () => {
    await expect(
      withRollback(async (tx) => {
        const accountId = await probeAccount(tx)
        return insertRule(tx, accountId, 'monthly', 'days_of_month', `'{1,32}'`)
      }),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('rejects day zero, which -1 exists precisely to avoid needing', async () => {
    await expect(
      withRollback(async (tx) => {
        const accountId = await probeAccount(tx)
        return insertRule(tx, accountId, 'monthly', 'days_of_month', `'{0}'`)
      }),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('rejects a null hiding inside the array', async () => {
    await expect(
      withRollback(async (tx) => {
        const accountId = await probeAccount(tx)
        return insertRule(tx, accountId, 'monthly', 'days_of_month', `'{1,null}'`)
      }),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('rejects days_of_month on a cadence that has no months', async () => {
    await expect(
      withRollback(async (tx) => {
        const accountId = await probeAccount(tx)
        return insertRule(tx, accountId, 'weekly', 'days_of_month', `'{1,15}'`)
      }),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('rejects days_of_week on a monthly rule', async () => {
    await expect(
      withRollback(async (tx) => {
        const accountId = await probeAccount(tx)
        return insertRule(tx, accountId, 'monthly', 'days_of_week', `'{1,4}'`)
      }),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('rejects a weekday outside 1–7', async () => {
    await expect(
      withRollback(async (tx) => {
        const accountId = await probeAccount(tx)
        return insertRule(tx, accountId, 'biweekly', 'days_of_week', `'{0,1}'`)
      }),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION })
  })

  it('leaves a rule with no day set alone', async () => {
    const rows = await withRollback(async (tx) => {
      const accountId = await probeAccount(tx)
      return insertRule(tx, accountId, 'monthly', 'days_of_month', 'null')
    })
    // Null, not '{}': "the day the anchor names" is a different statement from
    // "no days", and only one of them is storable.
    expect(rows[0]?.days_of_month).toBeNull()
  })
})

describe.skipIf(LOCAL_STACK === null)('user_settings.default_horizon_days', () => {
  const setHorizon = (tx: postgres.TransactionSql, days: number) => tx<{ days: number }[]>`
    update public.user_settings
    set default_horizon_days = ${days}
    where user_id = ${USER_A.id}
    returning default_horizon_days as days
  `

  it('accepts a horizon the dashboard toggle does not offer', async () => {
    // The reason the (30, 60, 90) check is gone: 10 is a perfectly sensible
    // thing for a person to want, and it used to require a migration.
    const rows = await withRollback((tx) => setHorizon(tx, 10))
    expect(Number(rows[0]?.days)).toBe(10)
  })

  it('still accepts each value the toggle does offer', async () => {
    for (const days of [30, 60, 90]) {
      const rows = await withRollback((tx) => setHorizon(tx, days))
      expect(Number(rows[0]?.days)).toBe(days)
    }
  })

  it('rejects a horizon of zero days', async () => {
    await expect(withRollback((tx) => setHorizon(tx, 0))).rejects.toMatchObject({
      code: CHECK_VIOLATION,
    })
  })

  it('rejects a horizon past the sanity bound', async () => {
    await expect(withRollback((tx) => setHorizon(tx, 731))).rejects.toMatchObject({
      code: CHECK_VIOLATION,
    })
  })
})
