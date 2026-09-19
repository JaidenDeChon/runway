/**
 * Issue #16's write-isolation criterion, against a live database: **a what-if
 * session changes the forecast and leaves every stored row exactly as it
 * found it.**
 *
 * The preview pipeline runs here as the dashboard runs it — the same
 * `app/lib/what-if.ts` the page imports, feeding the same
 * `ProjectionWindow.overrides` the engine reads — rather than a reimplementation
 * of it, which is what keeps this from being a test of its own arrangements.
 * What it adds over the unit tests is the database: real rows, seeded through
 * a real user's session, photographed before and after.
 *
 * **What this does and does not prove.** It proves the preview path wrote
 * nothing, and it would go red the day someone "makes what-if persist" by
 * pointing it at `occurrences`. It cannot prove no *other* path exists — a
 * suite only speaks for the code it ran. That negative is
 * `tests/guards/what-if-write-isolation.test.ts`'s job, which reads the source
 * instead of running it, and the two are meant to be read together.
 *
 * The snapshot is taken over the user's own session, not the admin
 * connection, so it sees exactly what the app would see. A write the app
 * could not make is not a write this test needs to catch.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { OccurrenceEdit } from '~~/app/lib/occurrence-editor'
import { EMPTY_SCRATCH, overridesInEffect, withScratchEdit } from '~~/app/lib/what-if'
import type { IsoDate } from '~~/domain/dates'
import { toMinorUnits } from '~~/domain/money'
import { project } from '~~/domain/projection'
import type { Account, RecurringItem, RunwayData } from '~~/domain/types'
import { type AuthContext, secondUserContext } from '../support/auth'
import { LOCAL_STACK } from '../support/database'
import { removeFixtures, seedHousehold } from '../support/fixtures'

const LABEL = 'what-if-isolation'
const TODAY = '2026-09-03' as IsoDate
const WINDOW = { start: TODAY, end: '2026-12-03' as IsoDate }

/**
 * Every table a what-if session could plausibly be made to write.
 *
 * Whole rows, not a column list: a list is a guess about which column a
 * future mistake would land in, and it silently stops covering any column
 * added after it was written. `*` also picks up `updated_at`, which matters
 * more than it looks — an "idempotent" write that set a column to the value
 * it already held would leave the data identical and the timestamp moved.
 */
const WATCHED_TABLES = [
  'accounts',
  'recurring_rules',
  'occurrences',
  'balance_readings',
  'transfers',
  'user_settings',
  'dashboard_hidden_accounts',
] as const

type Snapshot = Record<string, unknown[]>

/**
 * Every watched row the signed-in user can see, ordered so the comparison is
 * about content rather than about however Postgres felt like returning it.
 */
async function snapshot(context: AuthContext): Promise<Snapshot> {
  const entries = await Promise.all(
    WATCHED_TABLES.map(async (table) => {
      // biome-ignore lint/suspicious/noExplicitAny: the generated row types are per-table; this loop is generic over them.
      const { data, error } = await (context.client.from(table as any) as any).select('*')
      if (error) throw new Error(`could not read public.${table}: ${error.message}`)
      const rows = (data ?? []) as Record<string, unknown>[]
      const sorted = [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      return [table, sorted] as const
    }),
  )
  return Object.fromEntries(entries)
}

const ACCOUNT: Account = {
  id: 'a',
  name: 'Checking',
  balance: toMinorUnits(1_000),
  balanceAsOf: TODAY,
  color: 'chart-2',
  isDiscretionarySource: false,
}

const RENT: RecurringItem = {
  id: 'rent',
  name: 'Rent',
  kind: 'bill',
  amount: toMinorUnits(900),
  cadence: 'monthly',
  accountId: 'a',
  nextOccurrence: '2026-09-20',
  amountSource: 'fixed',
  depositHistory: [],
  isVariable: false,
}

/** What the dashboard would hold for this household, with no saved edits on it. */
const STORED: RunwayData = {
  accounts: [ACCOUNT],
  recurringItems: [RENT],
  transfers: [],
  balanceHistory: [],
  monthlyDiscretionarySpend: toMinorUnits(0),
  safetyCushion: toMinorUnits(200),
  timeZone: null,
  occurrenceOverrides: [],
}

/** Rent for September, previewed at three times its real size. */
const PREVIEW: OccurrenceEdit = {
  itemId: 'rent',
  date: '2026-09-20' as IsoDate,
  scope: 'once',
  amount: toMinorUnits(-2_700),
  projectedAmount: toMinorUnits(-900),
}

describe.skipIf(LOCAL_STACK === null)('a what-if session writes nothing', () => {
  let context: AuthContext

  beforeAll(async () => {
    await removeFixtures(LABEL)
    context = await secondUserContext()
    await seedHousehold(context, {
      label: LABEL,
      accounts: [ACCOUNT],
      recurringItems: [RENT],
      materializeOccurrences: WINDOW,
    })
  })

  afterAll(async () => {
    if (!LOCAL_STACK) return
    await removeFixtures(LABEL)
  })

  it('has rows to leave alone, so an empty snapshot cannot pass for an unchanged one', async () => {
    const before = await snapshot(context)
    expect(before.accounts?.length).toBe(1)
    expect(before.recurring_rules?.length).toBe(1)
    expect((before.occurrences?.length ?? 0) > 0).toBe(true)
  })

  it('changes the forecast and leaves every stored row byte-identical', async () => {
    const before = await snapshot(context)

    // The session, run exactly as `app/pages/index.vue` runs it.
    const scratch = withScratchEdit(EMPTY_SCRATCH, PREVIEW)
    const preview = project(STORED, { ...WINDOW, overrides: overridesInEffect(true, scratch) })
    const stored = project(STORED, WINDOW)

    // Non-vacuous in the direction that matters: had the preview done
    // nothing, "wrote nothing" would be a statement about an inert call.
    expect(preview.combinedSummary.ending).not.toBe(stored.combinedSummary.ending)

    expect(await snapshot(context)).toEqual(before)
  })

  it('leaves nothing behind once the mode goes off', async () => {
    const before = await snapshot(context)

    const scratch = withScratchEdit(EMPTY_SCRATCH, PREVIEW)
    // Switching off hides the list rather than needing it cleared — the
    // projection returns to the stored numbers, and no flush runs on the way.
    const off = project(STORED, { ...WINDOW, overrides: overridesInEffect(false, scratch) })
    expect(off.combinedSummary.ending).toBe(project(STORED, WINDOW).combinedSummary.ending)

    expect(await snapshot(context)).toEqual(before)
  })

  it('still writes nothing when the same occurrence is previewed repeatedly', async () => {
    const before = await snapshot(context)

    // Ten edits to one day is the shape of someone playing with the number —
    // the case where a "save as you go" shortcut would be most tempting.
    let scratch = withScratchEdit(EMPTY_SCRATCH, PREVIEW)
    for (let step = 1; step <= 10; step += 1) {
      scratch = withScratchEdit(scratch, { ...PREVIEW, amount: toMinorUnits(-900 - step * 100) })
    }
    expect(scratch).toHaveLength(1)
    project(STORED, { ...WINDOW, overrides: overridesInEffect(true, scratch) })

    expect(await snapshot(context)).toEqual(before)
  })
})
