import { describe, expect, it } from 'vitest'
import { toMinorUnits } from '~~/domain/money'
import type { AccountSeries } from '~~/domain/projection'
import type { Account } from '~~/domain/types'
import {
  endingBalances,
  legendEntries,
  nextHiddenAccounts,
  visibleAccountIds,
} from './account-selection'

const account = (id: string, name: string, balance: number): Account => ({
  id,
  name,
  balance: toMinorUnits(balance),
  balanceAsOf: '2026-08-15',
  color: 'chart-2',
  isDiscretionarySource: false,
})

const CHECKING = account('acct-checking', 'Checking', 1_000)
const SAVINGS = account('acct-savings', 'Savings', 2_000)

describe('visibleAccountIds', () => {
  it('is every account when nothing is hidden', () => {
    expect(visibleAccountIds([CHECKING, SAVINGS], [])).toEqual(['acct-checking', 'acct-savings'])
  })

  it('excludes an id in the hidden set', () => {
    expect(visibleAccountIds([CHECKING, SAVINGS], ['acct-savings'])).toEqual(['acct-checking'])
  })

  it('is inert for a hidden id that names no current account', () => {
    expect(visibleAccountIds([CHECKING, SAVINGS], ['acct-deleted'])).toEqual([
      'acct-checking',
      'acct-savings',
    ])
  })
})

describe('nextHiddenAccounts', () => {
  it('refuses to hide the last visible account', () => {
    expect(nextHiddenAccounts([], ['acct-checking'], 'acct-checking', false)).toBeNull()
  })

  it('hides one of two, returning a one-element set', () => {
    expect(
      nextHiddenAccounts([], ['acct-checking', 'acct-savings'], 'acct-savings', false),
    ).toEqual(['acct-savings'])
  })

  it('re-checking removes the id from the hidden set', () => {
    expect(nextHiddenAccounts(['acct-savings'], ['acct-checking'], 'acct-savings', true)).toEqual(
      [],
    )
  })

  it('checking an id already visible is a no-op', () => {
    expect(
      nextHiddenAccounts([], ['acct-checking', 'acct-savings'], 'acct-checking', true),
    ).toEqual([])
  })

  it('hiding an already-hidden id does not duplicate it', () => {
    // Three accounts, one already hidden, so two remain visible — the guard
    // that refuses to empty the chart does not apply, and this exercises the
    // "already in the set" branch rather than the "would empty it" one.
    expect(
      nextHiddenAccounts(['acct-savings'], ['acct-checking', 'acct-credit'], 'acct-savings', false),
    ).toEqual(['acct-savings'])
  })
})

describe('endingBalances', () => {
  it('reads summary.ending, not the last point of the series', () => {
    // The series' last point deliberately disagrees with the summary, so a
    // regression back to `points[points.length - 1].balance` fails loudly
    // rather than silently agreeing by coincidence.
    const series: AccountSeries[] = [
      {
        accountId: 'acct-checking',
        points: [
          { date: '2026-08-01', balance: toMinorUnits(100) },
          { date: '2026-08-02', balance: toMinorUnits(999) },
        ],
        summary: { lowest: null, ending: toMinorUnits(250) },
      },
    ]
    expect(endingBalances(series).get('acct-checking')).toBe(toMinorUnits(250))
  })

  it('keys by account id, one entry per series', () => {
    const series: AccountSeries[] = [
      { accountId: 'a', points: [], summary: { lowest: null, ending: toMinorUnits(10) } },
      { accountId: 'b', points: [], summary: { lowest: null, ending: toMinorUnits(20) } },
    ]
    const result = endingBalances(series)
    expect(result.get('a')).toBe(toMinorUnits(10))
    expect(result.get('b')).toBe(toMinorUnits(20))
  })
})

describe('legendEntries', () => {
  it('preserves accounts order and reads each ending balance from the map', () => {
    const ending = endingBalances([
      {
        accountId: 'acct-savings',
        points: [],
        summary: { lowest: null, ending: toMinorUnits(3_208) },
      },
      {
        accountId: 'acct-checking',
        points: [],
        summary: { lowest: null, ending: toMinorUnits(500) },
      },
    ])
    const entries = legendEntries([CHECKING, SAVINGS], ending, [])
    expect(entries.map((entry) => entry.accountId)).toEqual(['acct-checking', 'acct-savings'])
    expect(entries[0]?.endingBalance).toBe(toMinorUnits(500))
    expect(entries[1]?.endingBalance).toBe(toMinorUnits(3_208))
  })

  it('falls back to account.balance when an account has no series entry', () => {
    const entries = legendEntries([CHECKING], new Map(), [])
    expect(entries[0]?.endingBalance).toBe(CHECKING.balance)
  })

  it('shows a deselected account still, with checked false', () => {
    const entries = legendEntries([CHECKING, SAVINGS], new Map(), ['acct-savings'])
    const savings = entries.find((entry) => entry.accountId === 'acct-savings')
    expect(savings?.checked).toBe(false)
    expect(savings?.disabled).toBe(false)
  })

  it('marks the sole visible account disabled', () => {
    const entries = legendEntries([CHECKING, SAVINGS], new Map(), ['acct-savings'])
    const checking = entries.find((entry) => entry.accountId === 'acct-checking')
    expect(checking?.disabled).toBe(true)
  })

  it('marks nothing disabled when more than one account is visible', () => {
    const entries = legendEntries([CHECKING, SAVINGS], new Map(), [])
    expect(entries.every((entry) => !entry.disabled)).toBe(true)
  })
})
