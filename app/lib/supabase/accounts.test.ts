import { describe, expect, it } from 'vitest'
import type { AccountRow, UserSettingsRow } from './accounts'
import { toAccount, toAccountColumns, toHouseholdSettings } from './accounts'

const row = (over: Partial<AccountRow> = {}): AccountRow => ({
  id: 'acct-1',
  user_id: 'user-1',
  name: 'Checking',
  color: 'chart-2',
  balance_cents: 214_000,
  balance_as_of: '2026-08-15',
  archived_on: null,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  ...over,
})

const settingsRow = (over: Partial<UserSettingsRow> = {}): UserSettingsRow => ({
  user_id: 'user-1',
  cushion_cents: 60_000,
  monthly_discretionary_cents: 103_400,
  discretionary_account_id: 'acct-1',
  default_horizon_days: 30,
  time_zone: null,
  balance_stale_after_days: 14,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  ...over,
})

describe('toAccount', () => {
  it('maps every column onto its domain field', () => {
    expect(toAccount(row(), null)).toEqual({
      id: 'acct-1',
      name: 'Checking',
      balance: 214_000,
      balanceAsOf: '2026-08-15',
      color: 'chart-2',
      isDiscretionarySource: false,
    })
  })

  it('derives isDiscretionarySource from the settings row, not a column on this one', () => {
    expect(toAccount(row(), 'acct-1').isDiscretionarySource).toBe(true)
    expect(toAccount(row(), 'some-other-account').isDiscretionarySource).toBe(false)
  })

  it('maps a null archived_on to an absent archivedOn, not to undefined', () => {
    const account = toAccount(row({ archived_on: null }), null)
    expect(account.archivedOn).toBeUndefined()
    expect(Object.hasOwn(account, 'archivedOn')).toBe(false)
  })

  it('maps a set archived_on to the domain field', () => {
    const account = toAccount(row({ archived_on: '2026-07-01' }), null)
    expect(account.archivedOn).toBe('2026-07-01')
  })

  it('keeps balance_cents as the integer PostgREST returns, with no coercion', () => {
    // PostgREST serialises a bigint column as a JSON number; this must not run
    // it through Number() or any arithmetic on the way in.
    expect(toAccount(row({ balance_cents: -4200 }), null).balance).toBe(-4200)
  })

  it('falls back to chart-2 for a color this app did not write', () => {
    // The database's check constraint should make this unreachable through the
    // app, but a hand-edited row or a schema this mapping has not caught up
    // with must render an account rather than throw one out of a list.
    expect(toAccount(row({ color: 'not-a-real-color' }), null).color).toBe('chart-2')
  })
})

describe('toAccountColumns', () => {
  it('maps a draft onto insert/update columns, leaving user_id to the caller', () => {
    expect(
      toAccountColumns({
        name: 'Savings',
        balance: 5000,
        balanceAsOf: '2026-08-20',
        color: 'chart-4',
        isDiscretionarySource: false,
      }),
    ).toEqual({
      name: 'Savings',
      color: 'chart-4',
      balance_cents: 5000,
      balance_as_of: '2026-08-20',
    })
  })
})

describe('toHouseholdSettings', () => {
  it('maps every column onto its domain field', () => {
    expect(toHouseholdSettings(settingsRow())).toEqual({
      safetyCushion: 60_000,
      monthlyDiscretionarySpend: 103_400,
      timeZone: null,
      staleAfterDays: 14,
      discretionaryAccountId: 'acct-1',
    })
  })

  it('falls back to the column defaults when there is no row yet', () => {
    // An account created before the signup trigger existed, or a race with it.
    expect(toHouseholdSettings(null)).toEqual({
      safetyCushion: 60_000,
      monthlyDiscretionarySpend: 0,
      timeZone: null,
      staleAfterDays: 14,
      discretionaryAccountId: null,
    })
  })
})
