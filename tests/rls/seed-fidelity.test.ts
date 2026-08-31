/**
 * The seed and the domain fixtures must describe the same households.
 *
 * There are two hand-maintained copies of each mirrored scenario:
 * `supabase/seed.sql`, which fills the local database, and `domain/seed.ts`,
 * which is what every screen currently renders and what the figures quoted in
 * `docs/design/*​/spec.md` were computed from. Nothing but a test keeps them in
 * step, and when they drift the local database quietly stops matching the
 * screenshots.
 *
 * Two households are mirrored, for the same reason twice. **User A** is the
 * comfortable one, and **user C** is the short one — the household that runs out
 * of money, and the only seeded data behind every Short state in the app. What
 * makes C short is proven in `domain/seed.test.ts` against the fixture; what
 * this file adds is that the database still holds that same household, so the
 * proof travels.
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
import {
  createSeedData,
  createShortSeedData,
  seedAccounts,
  seedRecurringItems,
  seedTransfers,
  shortSeedAccounts,
  shortSeedRecurringItems,
  shortSeedTransfers,
} from '~~/domain/seed'
import type { Account, RecurringItem, RunwayData, Transfer } from '~~/domain/types'
import { adminSql, LOCAL_STACK, USER_A, USER_C } from './helpers'

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

/** One mirrored scenario: the seeded user, and the fixture it has to match. */
interface Household {
  readonly label: string
  readonly userId: string
  readonly accounts: readonly Account[]
  readonly items: readonly RecurringItem[]
  readonly transfers: readonly Transfer[]
  readonly settings: RunwayData
  /** Names the seed deliberately carries twice, as a rule split. */
  readonly splitRuleNames: ReadonlySet<string>
}

const HOUSEHOLDS: readonly Household[] = [
  {
    label: 'user A — the comfortable household',
    userId: USER_A.id,
    accounts: seedAccounts,
    items: seedRecurringItems,
    transfers: seedTransfers,
    settings: createSeedData(),
    splitRuleNames: SPLIT_RULE_NAMES,
  },
  {
    label: 'user C — the short household',
    userId: USER_C.id,
    accounts: shortSeedAccounts,
    items: shortSeedRecurringItems,
    transfers: shortSeedTransfers,
    settings: createShortSeedData(),
    // No splits: apply-to-future is demonstrated once, on user A, and a second
    // copy would be a second thing to keep in step for nothing.
    splitRuleNames: new Set<string>(),
  },
]

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

  describe.each(HOUSEHOLDS)('$label', (household) => {
    it("mirrors the fixture's accounts", async () => {
      const sql = adminSql()
      try {
        const accounts = await sql<
          { name: string; color: string; balance_cents: string; balance_as_of: Date }[]
        >`select name, color, balance_cents, balance_as_of from public.accounts where user_id = ${household.userId}`
        for (const want of household.accounts) {
          const got = accounts.find((account) => account.name === want.name)
          expect(got, `account ${want.name} is missing from the seed`).toBeDefined()
          expect({
            balance: Number(got?.balance_cents),
            color: got?.color,
            asOf: got ? iso(got.balance_as_of) : undefined,
          }).toEqual({ balance: want.balance, color: want.color, asOf: want.balanceAsOf })
        }
        // Length as well as contents: an extra seeded account changes every
        // combined figure on the dashboard without failing any check above.
        expect(accounts).toHaveLength(household.accounts.length)
      } finally {
        await sql.end()
      }
    })

    it("mirrors the fixture's recurring items, rule for rule", () => {
      const forUser = rules.filter((row) => row.user_id === household.userId)

      for (const want of household.items) {
        const candidates = forUser.filter((row) => row.name === want.name)
        const isSplit = household.splitRuleNames.has(want.name)
        expect(
          candidates.length,
          `${want.name} should be ${isSplit ? 'a split pair' : 'a single rule'} in the seed`,
        ).toBe(isSplit ? 2 : 1)
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
          // A day set is part of the rule, not decoration: dropping C's
          // `{1, 15}` turns a semi-monthly paycheck into a monthly one and
          // halves the household's income without failing anything else.
          daysOfMonth: got?.days_of_month?.map(Number) ?? null,
        }).toEqual({
          amount: want.amount,
          cadence: want.cadence,
          anchor: want.nextOccurrence,
          variable: want.isVariable,
          source: want.amountSource,
          daysOfMonth: want.daysOfMonth ? [...want.daysOfMonth].sort((a, b) => a - b) : null,
        })
      }
    })

    it('adds no rule the fixture does not have', () => {
      // The trap this closes: a new cadence fixture dropped onto a mirrored
      // user because it was the fuller scenario. New fixtures belong on user B,
      // who mirrors nothing.
      const names = new Set(household.items.map((item) => item.name))
      const strangers = rules
        .filter((row) => row.user_id === household.userId && !names.has(row.name))
        .map((row) => row.name)
      expect(strangers).toEqual([])
    })

    it('carries no archived accounts', async () => {
      // An archived seed row would silently shrink the household every
      // screenshot and every spec figure was computed from — `activeAccounts`
      // filters it out of the projection but `mirrors the fixture's accounts`
      // above counts every row, archived or not, so a stray `archived_on`
      // here would fail there for a confusing reason rather than this one.
      const sql = adminSql()
      try {
        const [row] = await sql<{ count: string }[]>`
          select count(*)::text as count from public.accounts
          where user_id = ${household.userId} and archived_on is not null
        `
        expect(row?.count).toBe('0')
      } finally {
        await sql.end()
      }
    })

    it('stores the same settings the fixture holds', async () => {
      // The engine consumes the monthly discretionary figure directly and
      // divides it by the length of each month, so this is an equality and not
      // a conversion. It still has to be asserted: a seed that drifts from
      // domain/seed.ts makes every screenshot taken against the local stack a
      // picture of different data than the unit tests describe — and for user C
      // the cushion is half of what "short" even means.
      const sql = adminSql()
      try {
        const [settings] = await sql<
          {
            cushion_cents: string
            monthly_discretionary_cents: string
            time_zone: string | null
            discretionary_account_id: string | null
          }[]
        >`select cushion_cents, monthly_discretionary_cents, time_zone, discretionary_account_id
            from public.user_settings where user_id = ${household.userId}`
        expect(Number(settings?.cushion_cents)).toBe(household.settings.safetyCushion)
        // Null, and deliberately so: the fixtures follow the device, and a
        // browser-resolved zone is never written into the user's data.
        expect(settings?.time_zone ?? null).toBe(household.settings.timeZone)
        expect(Number(settings?.monthly_discretionary_cents)).toBe(
          household.settings.monthlyDiscretionarySpend,
        )

        // The flag is one column here and a boolean per row in the fixture; the
        // two have to name the same account or the drain lands somewhere else.
        const fixtureSource = household.accounts.find((account) => account.isDiscretionarySource)
        const flaggedId = settings?.discretionary_account_id ?? null
        if (flaggedId === null) {
          expect(fixtureSource, 'the seed flags no discretionary source').toBeUndefined()
        } else {
          const [flagged] = await sql<{ name: string }[]>`
            select name from public.accounts where id = ${flaggedId}
          `
          expect(flagged?.name ?? null).toBe(fixtureSource?.name ?? null)
        }
      } finally {
        await sql.end()
      }
    })

    it("mirrors the fixture's transfers", async () => {
      const sql = adminSql()
      try {
        const transfers = await sql<{ amount_cents: string; occurs_on: Date }[]>`
          select amount_cents, occurs_on from public.transfers
          where user_id = ${household.userId} order by occurs_on
        `
        expect(
          transfers.map((transfer) => ({
            amount: Number(transfer.amount_cents),
            date: iso(transfer.occurs_on),
          })),
        ).toEqual(
          [...household.transfers]
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((transfer) => ({ amount: transfer.amount, date: transfer.date })),
        )
      } finally {
        await sql.end()
      }
    })
  })
})

describe.skipIf(LOCAL_STACK === null)('the seed exercises the cadences it claims to', () => {
  it('includes a day-set rule, so the day-set generator path is not dead code', async () => {
    const sql = adminSql()
    try {
      const rows = await sql<{ name: string; days_of_month: number[] }[]>`
        select name, days_of_month from public.recurring_rules
        where days_of_month is not null order by name
      `
      expect(rows.length, 'no seeded rule carries days_of_month').toBeGreaterThan(0)
      // Named rather than taken from an arbitrary row: two users now carry a
      // day set, and only B's is written unsorted. Asserting against whichever
      // row came back first would let the sorting trigger go unproven the day
      // the query planner changed its mind about the order.
      const unsorted = rows.find((row) => row.name === 'B Paycheck')
      expect(unsorted, "B Paycheck is the seed's unsorted day set — it must stay one").toBeDefined()
      // Written `{15,1}` in the seed; the normalising trigger is what sorts it.
      expect(unsorted?.days_of_month.map(Number)).toEqual([1, 15])
      // And every day set, however it was written, comes back ascending.
      for (const row of rows) {
        const days = row.days_of_month.map(Number)
        expect(days, `${row.name} is not stored ascending`).toEqual([...days].sort((a, b) => a - b))
      }
    } finally {
      await sql.end()
    }
  })
})
