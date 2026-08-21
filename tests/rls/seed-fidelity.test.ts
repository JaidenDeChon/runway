/**
 * The seed and the domain fixture must describe the same household.
 *
 * There are two hand-maintained copies of user A's scenario: `supabase/seed.sql`,
 * which fills the local database, and `domain/seed.ts`, which is what every
 * screen currently renders and what the figures quoted in `docs/design/*​/spec.md`
 * were computed from. Nothing but a test keeps them in step, and when they drift
 * the local database quietly stops matching the screenshots.
 *
 * It also checks the seed's own occurrence generator against `occurrenceDates`.
 * The generator is SQL and the engine is TypeScript, and the two disagree in a
 * way that is easy to miss: Postgres' `generate_series(d, ..., interval '1 month')`
 * is **sticky** — from Jan 31 it yields Feb 28 and then Mar 28, carrying the
 * clamp forward — while `addMonthsClamped` returns to Mar 31. The seed steps over
 * month starts to avoid that, and this is what proves it still does.
 *
 * Read-only: it asserts against the seed as loaded and writes nothing.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { occurrenceDates } from '~~/domain/cadence'
import { maxDate } from '~~/domain/dates'
import { createSeedData, seedAccounts, seedRecurringItems, seedTransfers } from '~~/domain/seed'
import type { RecurringItem } from '~~/domain/types'
import { adminSql, LOCAL_STACK, USER_A } from './helpers'

/** The horizon `supabase/seed.sql` generates through. */
const SEED_HORIZON_END = '2026-12-31'

/**
 * `Rent` is deliberately two rows here and one in the domain module: the seed
 * carries an August rule that ends and a September rule that starts, so
 * apply-to-future is visible in real data. The September rule is the one that
 * must match the fixture — it is what the dashboard and the shortfall screen
 * project. See the comment above the split in `supabase/seed.sql`.
 */
const SPLIT_RULE_NAMES = new Set(['Rent'])

interface RuleRow {
  id: string
  user_id: string
  name: string
  kind: 'bill' | 'income'
  cadence: RecurringItem['cadence']
  amount_cents: string
  anchor_date: Date
  starts_on: Date | null
  ends_on: Date | null
  is_variable: boolean
  amount_source: 'fixed' | 'predicted'
  days_of_month: number[] | null
  days_of_week: number[] | null
}

const iso = (date: Date): string => date.toISOString().slice(0, 10)

/** Rebuilds the domain-shaped item a seeded row stands for. */
function toItem(row: RuleRow): RecurringItem {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    amount: Number(row.amount_cents),
    cadence: row.cadence,
    accountId: 'unused-here',
    nextOccurrence: iso(row.anchor_date),
    amountSource: row.amount_source,
    depositHistory: [],
    isVariable: row.is_variable,
    // Spread rather than assign `undefined`: `exactOptionalPropertyTypes` draws a
    // distinction between "absent" and "present and undefined", and RecurringItem
    // means the first one.
    ...(row.starts_on ? { startsOn: iso(row.starts_on) } : {}),
    ...(row.ends_on ? { endsOn: iso(row.ends_on) } : {}),
    ...(row.days_of_month ? { daysOfMonth: row.days_of_month.map(Number) } : {}),
    ...(row.days_of_week ? { daysOfWeek: row.days_of_week.map(Number) } : {}),
  }
}

describe.skipIf(LOCAL_STACK === null)('the seed and the domain fixture agree', () => {
  let rules: RuleRow[] = []
  let occurrencesByRule = new Map<string, string[]>()

  beforeAll(async () => {
    const sql = adminSql()
    try {
      rules = await sql<RuleRow[]>`
        select id, user_id, name, kind, cadence, amount_cents, anchor_date, starts_on, ends_on,
               is_variable, amount_source, days_of_month, days_of_week
        from public.recurring_rules
      `
      const rows = await sql<{ rule_id: string; projected_date: Date }[]>`
        select rule_id, projected_date from public.occurrences order by projected_date
      `
      occurrencesByRule = new Map()
      for (const row of rows) {
        const dates = occurrencesByRule.get(row.rule_id) ?? []
        dates.push(iso(row.projected_date))
        occurrencesByRule.set(row.rule_id, dates)
      }
    } finally {
      await sql.end()
    }
  })

  it('generates exactly the dates the engine projects, for every seeded rule', () => {
    // Both users, not just A: B's semi-monthly paycheck is the only day-set
    // fixture there is, so excluding B would leave that path unproven.
    const disagreements: string[] = []
    for (const row of rules) {
      const item = toItem(row)
      const start = maxDate(item.nextOccurrence, item.startsOn ?? item.nextOccurrence)
      const expected = occurrenceDates(item, start, SEED_HORIZON_END)
      const actual = occurrencesByRule.get(row.id) ?? []
      if (actual.join(',') !== expected.join(',')) {
        disagreements.push(
          `${row.name} (${row.cadence}, anchor ${iso(row.anchor_date)})\n` +
            `  seed  : ${actual.join(', ')}\n  engine: ${expected.join(', ')}`,
        )
      }
    }
    expect(disagreements).toEqual([])
  })

  it("mirrors domain/seed.ts's accounts", async () => {
    const sql = adminSql()
    try {
      const accounts = await sql<
        { name: string; color: string; balance_cents: string; balance_as_of: Date }[]
      >`select name, color, balance_cents, balance_as_of from public.accounts where user_id = ${USER_A.id}`
      for (const want of seedAccounts) {
        const got = accounts.find((account) => account.name === want.name)
        expect(got, `account ${want.name} is missing from the seed`).toBeDefined()
        expect({
          balance: Number(got?.balance_cents),
          color: got?.color,
          asOf: got ? iso(got.balance_as_of) : undefined,
        }).toEqual({ balance: want.balance, color: want.color, asOf: want.balanceAsOf })
      }
      expect(accounts).toHaveLength(seedAccounts.length)
    } finally {
      await sql.end()
    }
  })

  it("mirrors domain/seed.ts's recurring items, rule for rule", () => {
    const forUserA = rules.filter((row) => row.user_id === USER_A.id)

    for (const want of seedRecurringItems) {
      const candidates = forUserA.filter((row) => row.name === want.name)
      const isSplit = SPLIT_RULE_NAMES.has(want.name)
      expect(
        candidates.length,
        `${want.name} should be ${isSplit ? 'a split pair' : 'a single rule'} in the seed`,
      ).toBe(isSplit ? 2 : 1)
      expect(candidates.length, `rule ${want.name} is missing from the seed`).toBeGreaterThan(0)
      // For a split rule, the forward-looking half is the comparable one.
      const got = candidates.find((row) => iso(row.anchor_date) === want.nextOccurrence)
      expect(
        got,
        `no ${want.name} rule anchored ${want.nextOccurrence} — a split must keep its ` +
          `forward-looking half aligned with the fixture`,
      ).toBeDefined()
      expect({
        amount: Number(got?.amount_cents),
        cadence: got?.cadence,
        anchor: got ? iso(got.anchor_date) : undefined,
        variable: got?.is_variable,
        source: got?.amount_source,
      }).toEqual({
        amount: want.amount,
        cadence: want.cadence,
        anchor: want.nextOccurrence,
        variable: want.isVariable,
        source: want.amountSource,
      })
    }
  })

  it('adds no rule to user A that the fixture does not have', () => {
    // The trap this closes: a new cadence fixture dropped onto user A because it
    // was the fuller scenario. New fixtures belong on user B, who mirrors nothing.
    const names = new Set(seedRecurringItems.map((item) => item.name))
    const strangers = rules
      .filter((row) => row.user_id === USER_A.id && !names.has(row.name))
      .map((row) => row.name)
    expect(strangers).toEqual([])
  })

  it('stores the same monthly discretionary figure the fixture does', async () => {
    // The engine consumes the monthly figure directly and divides it by the
    // length of each month, so this is an equality and not a conversion. It
    // still has to be asserted: a seed that drifts from domain/seed.ts makes
    // every screenshot taken against the local stack a picture of different data
    // than the unit tests describe.
    const sql = adminSql()
    try {
      const [settings] = await sql<
        { cushion_cents: string; monthly_discretionary_cents: string; time_zone: string | null }[]
      >`select cushion_cents, monthly_discretionary_cents, time_zone
          from public.user_settings where user_id = ${USER_A.id}`
      const fixture = createSeedData()
      expect(Number(settings?.cushion_cents)).toBe(fixture.safetyCushion)
      // Null, and deliberately so: the fixture follows the device, and a
      // browser-resolved zone is never written into the user's data.
      expect(settings?.time_zone ?? null).toBe(fixture.timeZone)
      expect(Number(settings?.monthly_discretionary_cents)).toBe(fixture.monthlyDiscretionarySpend)
    } finally {
      await sql.end()
    }
  })

  it("mirrors domain/seed.ts's transfers", async () => {
    const sql = adminSql()
    try {
      const transfers = await sql<{ amount_cents: string; occurs_on: Date }[]>`
        select amount_cents, occurs_on from public.transfers
        where user_id = ${USER_A.id} order by occurs_on
      `
      expect(
        transfers.map((transfer) => ({
          amount: Number(transfer.amount_cents),
          date: iso(transfer.occurs_on),
        })),
      ).toEqual(
        [...seedTransfers]
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((transfer) => ({ amount: transfer.amount, date: transfer.date })),
      )
    } finally {
      await sql.end()
    }
  })
})

describe.skipIf(LOCAL_STACK === null)('the seed exercises the cadences it claims to', () => {
  it('includes a day-set rule, so the day-set generator path is not dead code', async () => {
    const sql = adminSql()
    try {
      const [row] = await sql<{ name: string; days_of_month: number[] }[]>`
        select name, days_of_month from public.recurring_rules where days_of_month is not null
      `
      expect(row, 'no seeded rule carries days_of_month').toBeDefined()
      // Written unsorted in the seed; the normalising trigger is what sorts it.
      expect(row?.days_of_month.map(Number)).toEqual([1, 15])
    } finally {
      await sql.end()
    }
  })
})
