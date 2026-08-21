/**
 * Dummy data, standing in for persistence until a real store lands.
 *
 * The figures mirror the seeded values in the Claude Design exports so the
 * screens can be compared against `docs/design/*​/screens/*.png`. They are
 * synthetic; the design's own "today" is 2026-08-15, which `SEED_TODAY` pins so
 * the seeded relative dates keep their intended spacing.
 *
 * Note: the exports computed their projections inline in floating-point
 * dollars, so figures quoted in the specs (a $4,886 low point, a $5,366 today
 * balance) will not match this engine to the cent. The engine is the authority;
 * chasing the prototype's rounding would mean reproducing its bugs.
 */

import type { IsoDate } from './dates'
import { toMinorUnits } from './money'
import type { Account, RecurringItem, RunwayData, Transfer } from './types'

/** The design's "today". Real code takes today from the caller, never from here. */
export const SEED_TODAY: IsoDate = '2026-08-15'

export const seedAccounts: readonly Account[] = [
  {
    id: 'acct-checking',
    name: 'Checking',
    balance: toMinorUnits(2140),
    balanceAsOf: SEED_TODAY,
    color: 'chart-3',
    isDiscretionarySource: true,
  },
  {
    id: 'acct-savings',
    name: 'Savings',
    balance: toMinorUnits(3200),
    balanceAsOf: SEED_TODAY,
    color: 'chart-4',
    isDiscretionarySource: false,
  },
] as const

export const seedRecurringItems: readonly RecurringItem[] = [
  {
    id: 'item-car-payment',
    name: 'Car payment',
    kind: 'bill',
    amount: toMinorUnits(310),
    cadence: 'monthly',
    accountId: 'acct-checking',
    nextOccurrence: '2026-08-20',
    amountSource: 'fixed',
    depositHistory: [],
    isVariable: false,
  },
  {
    id: 'item-paycheck',
    name: 'Paycheck',
    kind: 'income',
    // Equals the mean of depositHistory: prediction is stored, not recomputed
    // at render time, so the two must already agree in seeded data.
    amount: toMinorUnits(2450),
    cadence: 'biweekly',
    accountId: 'acct-checking',
    nextOccurrence: '2026-08-21',
    amountSource: 'predicted',
    depositHistory: [toMinorUnits(2440), toMinorUnits(2450), toMinorUnits(2460)],
    isVariable: false,
  },
  {
    id: 'item-car-insurance',
    name: 'Car insurance',
    kind: 'bill',
    amount: toMinorUnits(175),
    cadence: 'monthly',
    accountId: 'acct-checking',
    nextOccurrence: '2026-08-24',
    amountSource: 'fixed',
    depositHistory: [],
    isVariable: false,
  },
  {
    id: 'item-electric-water',
    name: 'Electric & water',
    kind: 'bill',
    amount: toMinorUnits(140),
    cadence: 'monthly',
    accountId: 'acct-checking',
    nextOccurrence: '2026-08-28',
    amountSource: 'fixed',
    depositHistory: [],
    isVariable: true,
  },
  {
    id: 'item-side-work',
    name: 'Side work',
    kind: 'income',
    amount: toMinorUnits(400),
    cadence: 'monthly',
    accountId: 'acct-savings',
    nextOccurrence: '2026-08-31',
    amountSource: 'fixed',
    depositHistory: [],
    isVariable: false,
  },
  {
    id: 'item-rent',
    name: 'Rent',
    kind: 'bill',
    amount: toMinorUnits(1650),
    cadence: 'monthly',
    accountId: 'acct-checking',
    nextOccurrence: '2026-09-01',
    amountSource: 'fixed',
    depositHistory: [],
    isVariable: false,
  },
  {
    id: 'item-phone',
    name: 'Phone',
    kind: 'bill',
    amount: toMinorUnits(55),
    cadence: 'monthly',
    accountId: 'acct-checking',
    nextOccurrence: '2026-09-03',
    amountSource: 'fixed',
    depositHistory: [],
    isVariable: false,
  },
  {
    id: 'item-streaming',
    name: 'Streaming',
    kind: 'bill',
    amount: toMinorUnits(18),
    cadence: 'monthly',
    accountId: 'acct-savings',
    nextOccurrence: '2026-09-08',
    amountSource: 'fixed',
    depositHistory: [],
    isVariable: false,
  },
] as const

export const seedTransfers: readonly Transfer[] = [
  {
    id: 'xfer-1',
    fromAccountId: 'acct-checking',
    toAccountId: 'acct-savings',
    amount: toMinorUnits(400),
    date: '2026-08-01',
    createdAt: 1,
  },
  {
    id: 'xfer-2',
    fromAccountId: 'acct-savings',
    toAccountId: 'acct-checking',
    amount: toMinorUnits(150),
    date: '2026-07-18',
    createdAt: 2,
  },
] as const

export function createSeedData(): RunwayData {
  return {
    accounts: [...seedAccounts],
    recurringItems: [...seedRecurringItems],
    transfers: [...seedTransfers],
    monthlyDiscretionarySpend: toMinorUnits(1034),
    safetyCushion: toMinorUnits(600),
    timeZone: null,
  }
}

/** The zero state — what "Skip to dashboard" from onboarding actually produces. */
export function createEmptyData(): RunwayData {
  return {
    accounts: [],
    recurringItems: [],
    transfers: [],
    monthlyDiscretionarySpend: 0,
    safetyCushion: toMinorUnits(600),
    timeZone: null,
  }
}
