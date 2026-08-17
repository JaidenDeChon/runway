/**
 * Acceptance criterion: "a test proving user A cannot read user B's rows."
 *
 * v1 is single-user, which is exactly why this file exists now. The data model
 * is multi-tenant from day one; retrofitting tenancy after rows exist is the
 * migration that leaks other people's balances.
 *
 * Two design rules here, both learned the hard way:
 *
 * 1. The rows these tests act on are created and torn down by this file over
 *    the admin connection, never by a policy-governed client. A test that asks
 *    user B "which of your rows should I attack?" is asking a question through
 *    the very mechanism under test — when the policy is wide, B answers with
 *    somebody else's row and the destructive cases mutate the seed.
 * 2. Assertions are on ownership, never on exact totals, so issue #3 can add
 *    seed rows without rewriting this file.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  adminSql,
  assertUserAOnlySeesOwnRows,
  FIXTURE_TABLE,
  LOCAL_STACK,
  signedInClient,
  USER_A,
  USER_B,
} from './helpers'

/** Labels are prefixed so teardown can find them even after a failed run. */
const PROBE_PREFIX = 'probe:isolation:'
const PROBE_B_LABEL = `${PROBE_PREFIX}owned-by-b`

let probeBId: string

async function removeProbes(): Promise<void> {
  const sql = adminSql()
  try {
    await sql`delete from public.${sql(FIXTURE_TABLE)} where label like ${`${PROBE_PREFIX}%`}`
  } finally {
    await sql.end()
  }
}

describe.skipIf(LOCAL_STACK === null)('cross-user isolation', () => {
  beforeAll(async () => {
    await removeProbes()
    const sql = adminSql()
    try {
      const [row] = await sql<{ id: string }[]>`
        insert into public.${sql(FIXTURE_TABLE)} (user_id, label)
        values (${USER_B.id}, ${PROBE_B_LABEL})
        returning id
      `
      if (!row) throw new Error('could not create the isolation probe row')
      probeBId = row.id
    } finally {
      await sql.end()
    }
  })

  // Runs even when an assertion above threw, so a breach cannot leave debris.
  afterAll(async () => {
    if (!LOCAL_STACK) return
    await removeProbes()
  })

  it('lets each user read their own rows', async () => {
    const a = await signedInClient(USER_A)
    const { data, error } = await a.from(FIXTURE_TABLE).select('id, user_id')

    expect(error).toBeNull()
    expect((data ?? []).length).toBeGreaterThan(0)
    expect((data ?? []).every((row) => row.user_id === USER_A.id)).toBe(true)
  })

  it('shows user A nothing owned by user B', async () => {
    await expect(assertUserAOnlySeesOwnRows()).resolves.toBeGreaterThan(0)
  })

  it('shows user B nothing owned by user A', async () => {
    const b = await signedInClient(USER_B)
    const { data, error } = await b.from(FIXTURE_TABLE).select('id, user_id')

    expect(error).toBeNull()
    expect((data ?? []).length).toBeGreaterThan(0)
    expect((data ?? []).every((row) => row.user_id === USER_B.id)).toBe(true)
  })

  it("hides user B's row even when user A asks for it by id", async () => {
    const a = await signedInClient(USER_A)
    const { data, error } = await a.from(FIXTURE_TABLE).select('id').eq('id', probeBId)

    expect(error).toBeNull()
    expect(data ?? []).toHaveLength(0)
  })

  it("will not let user A update user B's row", async () => {
    const a = await signedInClient(USER_A)
    const { data: updated } = await a
      .from(FIXTURE_TABLE)
      .update({ label: 'clobbered by user a' })
      .eq('id', probeBId)
      .select('id')

    // The USING clause makes the row invisible to the UPDATE, so it matches
    // nothing rather than erroring.
    expect(updated ?? []).toHaveLength(0)

    // Confirmed over the admin connection: asking a policy-governed client
    // whether the write landed would be asking the mechanism under test.
    const sql = adminSql()
    try {
      const [row] = await sql<{ label: string }[]>`
        select label from public.${sql(FIXTURE_TABLE)} where id = ${probeBId}
      `
      expect(row?.label).toBe(PROBE_B_LABEL)
    } finally {
      await sql.end()
    }
  })

  it("will not let user A delete user B's row", async () => {
    const a = await signedInClient(USER_A)
    await a.from(FIXTURE_TABLE).delete().eq('id', probeBId)

    const sql = adminSql()
    try {
      const [row] = await sql<{ count: string }[]>`
        select count(*)::text as count
        from public.${sql(FIXTURE_TABLE)}
        where id = ${probeBId}
      `
      expect(row?.count).toBe('1')
    } finally {
      await sql.end()
    }
  })

  it('will not let user A insert a row owned by user B', async () => {
    const a = await signedInClient(USER_A)
    const { error } = await a
      .from(FIXTURE_TABLE)
      .insert({ user_id: USER_B.id, label: `${PROBE_PREFIX}planted-by-a` })

    // The WITH CHECK clause rejects this outright — a violation, not a no-op.
    expect(error).not.toBeNull()
  })
})
