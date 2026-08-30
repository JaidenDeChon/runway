/**
 * Seeding realistic domain fixtures, through the interfaces production uses.
 *
 * Issue #5: "Seed utilities create realistic domain fixtures through the same
 * code paths as production." Two halves of that, and both are load-bearing:
 *
 * 1. **The rows go in through PostgREST, under a user's own session** — never
 *    over the admin connection. A fixture written with `BYPASSRLS` can violate
 *    every policy the suite exists to prove, and then the tests are asserting
 *    against data the application could never have created. Seeding here is
 *    itself a test of the INSERT policies.
 *
 * 2. **The shapes are the domain's** — `Account`, `RecurringItem`, `Transfer`
 *    from `domain/types.ts`, and occurrences expanded by the engine's own
 *    `occurrenceDates`. A fixture built from hand-written column literals drifts
 *    away from what the app means by an account; one built from the domain types
 *    cannot, because the compiler is holding it to them.
 *
 * ## What this deliberately does not touch
 *
 * `user_settings` — the cushion, the discretionary figure, the timezone
 * override. There is exactly one row per user, and `tests/rls/seed-fidelity.test.ts`
 * asserts that users A and C still mirror `domain/seed.ts` exactly. A fixture
 * that overwrote those would corrupt the household the seed exists to hold
 * while telling nobody. `Account.isDiscretionarySource` lives in that table too,
 * so it is not represented here; see the human-TODO list in the PR.
 *
 * ## Cleanup
 *
 * Every row is named with a `fixture:<label>:` prefix and removed by that
 * prefix, so a run that dies mid-test leaves debris that the next `beforeAll`
 * sweeps rather than debris that accumulates. Deletion cascades from `accounts`
 * to rules, occurrences and transfers (see docs/database/schema.md), so removing
 * the accounts is enough — but transfers are removed explicitly anyway, because
 * relying on a cascade to clean up after a test means a broken cascade shows up
 * as a mysterious failure three files later.
 */

import { occurrenceDates } from '~~/domain/cadence'
import type { IsoDate } from '~~/domain/dates'
import type { Account, RecurringItem, Transfer } from '~~/domain/types'
import type { AuthContext } from './auth'
import { adminSql, type RunwayTestClient } from './database'

/** Prefix every fixture row's name carries, so teardown can find it. */
export const FIXTURE_PREFIX = 'fixture:'

export function fixtureName(label: string, name: string): string {
  const full = `${FIXTURE_PREFIX}${label}:${name}`
  // `accounts.name` and `recurring_rules.name` are both `check (length(btrim(name)) between 1 and 80)`.
  // Failing here names the fixture; failing in Postgres names a constraint.
  if (full.length > 80) {
    throw new Error(`fixture name "${full}" is ${full.length} chars; the column allows 80`)
  }
  return full
}

export interface HouseholdSpec {
  /** Short, unique to the test file. Becomes part of every row's name. */
  readonly label: string
  readonly accounts: readonly Account[]
  readonly recurringItems?: readonly RecurringItem[]
  readonly transfers?: readonly Transfer[]
  /**
   * When set, each rule is expanded across this window by the engine's own
   * `occurrenceDates` and the resulting occurrences are inserted. Omitted means
   * no occurrence rows, which is the right default: most assertions do not need
   * them and materializing them is the slowest thing this module does.
   */
  readonly materializeOccurrences?: { readonly start: IsoDate; readonly end: IsoDate }
}

export interface SeededHousehold {
  readonly userId: string
  /** Domain id -> database uuid, for accounts. */
  readonly accountIds: ReadonlyMap<string, string>
  /** Domain id -> database uuid, for recurring rules. */
  readonly ruleIds: ReadonlyMap<string, string>
  readonly transferIds: readonly string[]
  readonly occurrenceCount: number
}

type InsertResult = readonly [Record<string, unknown>[] | null, { message: string } | null]

function requireInsert(result: InsertResult, what: string): Record<string, unknown>[] {
  const [rows, error] = result
  if (error) throw new Error(`could not seed ${what}: ${error.message}`)
  if (!rows) throw new Error(`could not seed ${what}: the API returned no rows`)
  return rows
}

/**
 * Writes a household as the signed-in user the context speaks for.
 *
 * Throws for an unauthenticated or expired context rather than quietly writing
 * nothing — a seeding helper that no-ops is a test that asserts against an
 * empty table and passes.
 */
export async function seedHousehold(
  context: AuthContext,
  spec: HouseholdSpec,
): Promise<SeededHousehold> {
  const userId = context.userId
  if (!userId) {
    throw new Error(`cannot seed a household for the "${context.name}" context — it has no user`)
  }
  const client: RunwayTestClient = context.client

  const accountRows = requireInsert(
    await insert(
      client,
      'accounts',
      spec.accounts.map((account) => ({
        user_id: userId,
        name: fixtureName(spec.label, account.name),
        color: account.color,
        balance_cents: account.balance,
        balance_as_of: account.balanceAsOf,
        archived_on: account.archivedOn ?? null,
      })),
    ),
    'accounts',
  )

  const accountIds = new Map<string, string>()
  spec.accounts.forEach((account, index) => {
    const row = accountRows[index]
    if (!row) throw new Error(`account "${account.name}" did not come back from the insert`)
    accountIds.set(account.id, row.id as string)
  })

  const ruleIds = new Map<string, string>()
  const items = spec.recurringItems ?? []
  if (items.length > 0) {
    const ruleRows = requireInsert(
      await insert(
        client,
        'recurring_rules',
        items.map((item) => {
          const accountId = accountIds.get(item.accountId)
          if (!accountId) {
            throw new Error(`rule "${item.name}" references unknown account "${item.accountId}"`)
          }
          return {
            user_id: userId,
            account_id: accountId,
            name: fixtureName(spec.label, item.name),
            kind: item.kind,
            amount_cents: item.amount,
            amount_source: item.amountSource,
            is_variable: item.isVariable,
            cadence: item.cadence,
            // `anchor_date` is the cadence's phase; `nextOccurrence` is what the
            // domain calls the same thing. See docs/database/schema.md.
            anchor_date: item.nextOccurrence,
            days_of_month: item.daysOfMonth ?? null,
            days_of_week: item.daysOfWeek ?? null,
            starts_on: item.startsOn ?? null,
            ends_on: item.endsOn ?? null,
          }
        }),
      ),
      'recurring_rules',
    )
    items.forEach((item, index) => {
      const row = ruleRows[index]
      if (!row) throw new Error(`rule "${item.name}" did not come back from the insert`)
      ruleIds.set(item.id, row.id as string)
    })
  }

  let occurrenceCount = 0
  const window = spec.materializeOccurrences
  if (window && items.length > 0) {
    const occurrences = items.flatMap((item) => {
      const ruleId = ruleIds.get(item.id)
      const accountId = accountIds.get(item.accountId)
      if (!ruleId || !accountId) return []
      return occurrenceDates(item, window.start, window.end).map((date) => ({
        user_id: userId,
        account_id: accountId,
        rule_id: ruleId,
        projected_date: date,
        // Sign is derived from `kind`, exactly as the engine derives it — a
        // bill can never be stored as a positive delta.
        projected_amount_cents: item.kind === 'income' ? item.amount : -item.amount,
        status: 'projected' as const,
      }))
    })
    if (occurrences.length > 0) {
      const rows = requireInsert(await insert(client, 'occurrences', occurrences), 'occurrences')
      occurrenceCount = rows.length
    }
  }

  const transferIds: string[] = []
  const transfers = spec.transfers ?? []
  if (transfers.length > 0) {
    const transferRows = requireInsert(
      await insert(
        client,
        'transfers',
        transfers.map((transfer) => {
          const from = accountIds.get(transfer.fromAccountId)
          const to = accountIds.get(transfer.toAccountId)
          if (!from || !to) {
            throw new Error(
              `transfer "${transfer.id}" references an account outside this household`,
            )
          }
          return {
            user_id: userId,
            from_account_id: from,
            to_account_id: to,
            amount_cents: transfer.amount,
            occurs_on: transfer.date,
          }
        }),
      ),
      'transfers',
    )
    for (const row of transferRows) transferIds.push(row.id as string)
  }

  return { userId, accountIds, ruleIds, transferIds, occurrenceCount }
}

/** Typed-enough insert helper. The generated `Database` types do not describe a heterogeneous batch. */
async function insert(
  client: RunwayTestClient,
  table: string,
  rows: readonly Record<string, unknown>[],
): Promise<InsertResult> {
  // biome-ignore lint/suspicious/noExplicitAny: the generated row types are per-table; this helper is generic over them by design.
  const { data, error } = await (client.from(table as any) as any).insert(rows).select('id')
  return [data as Record<string, unknown>[] | null, error]
}

/**
 * Removes every fixture row carrying `label`, for every user.
 *
 * Runs over the admin connection on purpose, and this is the one place that is
 * correct: teardown must succeed even when the test that ran before it left a
 * policy widened, a session expired, or rows owned by a user this process can no
 * longer authenticate as. Cleanup that can be blocked by the mechanism under
 * test is cleanup that eventually stops happening.
 */
export async function removeFixtures(label: string): Promise<void> {
  const pattern = `${FIXTURE_PREFIX}${label}:%`
  const sql = adminSql()
  try {
    // Transfers first: they reference accounts but carry no fixture-prefixed
    // name of their own, so they are found through the accounts they touch.
    await sql`
      delete from public.transfers t
      where exists (
        select 1 from public.accounts a
        where a.id in (t.from_account_id, t.to_account_id) and a.name like ${pattern}
      )
    `
    await sql`delete from public.recurring_rules where name like ${pattern}`
    await sql`delete from public.accounts where name like ${pattern}`
  } finally {
    await sql.end()
  }
}
