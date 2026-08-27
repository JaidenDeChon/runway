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

/**
 * The *short* household — the one the shortfall screen exists for.
 *
 * `seedAccounts` above describe somebody who is comfortably covered at every
 * horizon, which left every "Short" state in the app — the red verdict band, the
 * shortfall figure, "you're $X short on the 18th" — with no data behind it. This
 * is the other household, and it is the one most people arrive at this app
 * already living in.
 *
 * Three properties are deliberate, and `seed.test.ts` holds each of them:
 *
 * 1. **It is short at every horizon**, not just at 90 days. The running minimum
 *    can only fall as a window lengthens, so being short inside the first month
 *    is what makes it short at 60 and 90 too — but the first dip is what the
 *    dashboard's 30-day default has to show, so the dip is placed early.
 * 2. **It never climbs out.** Income is $2,124/month against $2,176 of bills and
 *    discretionary spending — a $52/month bleed. A household that recovers would
 *    quietly stop being a short fixture a few months after this file was
 *    written, and nobody would notice until a screenshot looked wrong.
 * 3. **The dip precedes the paycheck that would cover it.** Rent lands on the
 *    1st alongside a half-month's pay that does not meet it, so the window can
 *    close higher than its low point — the exact shape `shortfallThrough` exists
 *    to catch, and the one an endpoint-only reading gets wrong.
 *
 * The dates are anchored to `SEED_TODAY` like the fixture above, so the two
 * households describe the same fortnight. `supabase/seed.sql` mirrors this one
 * onto user C, rule for rule, the way user A mirrors the fixture above.
 */
export const shortSeedAccounts: readonly Account[] = [
  {
    id: 'acct-short-checking',
    name: 'Checking',
    // Read *on* payday, with that deposit already in it — which is the point:
    // the money is there and it is already spoken for. The paycheck occurrence
    // on this same day is therefore inside this reading and must not be added
    // a second time; the engine's same-day rule is what makes that true, and
    // this fixture is one of the places it is exercised.
    balance: toMinorUnits(1104.28),
    balanceAsOf: SEED_TODAY,
    color: 'chart-2',
    isDiscretionarySource: true,
  },
  {
    id: 'acct-short-savings',
    name: 'Savings',
    balance: toMinorUnits(45),
    balanceAsOf: SEED_TODAY,
    color: 'chart-4',
    isDiscretionarySource: false,
  },
] as const

export const shortSeedRecurringItems: readonly RecurringItem[] = [
  {
    id: 'short-item-paycheck',
    name: 'Paycheck',
    kind: 'income',
    // Semi-monthly — the 1st and the 15th — which is how a large share of
    // hourly and salaried people are actually paid, and the reason the low
    // point lands *before* money arrives rather than after it.
    amount: toMinorUnits(1062),
    cadence: 'monthly',
    daysOfMonth: [1, 15],
    accountId: 'acct-short-checking',
    nextOccurrence: '2026-09-01',
    amountSource: 'fixed',
    depositHistory: [],
    isVariable: false,
  },
  {
    id: 'short-item-car-insurance',
    name: 'Car insurance',
    kind: 'bill',
    amount: toMinorUnits(121),
    cadence: 'monthly',
    accountId: 'acct-short-checking',
    nextOccurrence: '2026-09-06',
    amountSource: 'fixed',
    depositHistory: [],
    isVariable: false,
  },
  {
    id: 'short-item-phone',
    name: 'Phone',
    kind: 'bill',
    amount: toMinorUnits(58),
    cadence: 'monthly',
    accountId: 'acct-short-checking',
    nextOccurrence: '2026-09-12',
    amountSource: 'fixed',
    depositHistory: [],
    isVariable: false,
  },
  {
    id: 'short-item-electric-water',
    name: 'Electric & water',
    kind: 'bill',
    amount: toMinorUnits(132),
    cadence: 'monthly',
    accountId: 'acct-short-checking',
    nextOccurrence: '2026-08-22',
    amountSource: 'fixed',
    depositHistory: [],
    isVariable: true,
  },
  {
    id: 'short-item-card-minimum',
    name: 'Card minimum',
    kind: 'bill',
    amount: toMinorUnits(95),
    cadence: 'monthly',
    accountId: 'acct-short-checking',
    nextOccurrence: '2026-08-24',
    amountSource: 'fixed',
    depositHistory: [],
    isVariable: false,
  },
  {
    id: 'short-item-rent',
    name: 'Rent',
    kind: 'bill',
    amount: toMinorUnits(1150),
    cadence: 'monthly',
    accountId: 'acct-short-checking',
    nextOccurrence: '2026-09-01',
    amountSource: 'fixed',
    depositHistory: [],
    isVariable: false,
  },
] as const

/**
 * One transfer, dated before both readings.
 *
 * It is deliberately *inside* the balances above rather than after them: a
 * transfer that predates every `balanceAsOf` is already contained in both
 * readings and must not be applied a second time. Somewhere in the fixtures
 * there should be one of those, and a household scraping the bottom of its
 * savings is the honest place for it.
 */
export const shortSeedTransfers: readonly Transfer[] = [
  {
    id: 'short-xfer-1',
    fromAccountId: 'acct-short-savings',
    toAccountId: 'acct-short-checking',
    amount: toMinorUnits(75),
    date: '2026-08-05',
    createdAt: 1,
  },
] as const

/** The short household. See `shortSeedAccounts` for what makes it short. */
export function createShortSeedData(): RunwayData {
  return {
    accounts: [...shortSeedAccounts],
    recurringItems: [...shortSeedRecurringItems],
    transfers: [...shortSeedTransfers],
    monthlyDiscretionarySpend: toMinorUnits(620),
    safetyCushion: toMinorUnits(250),
    timeZone: null,
  }
}

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
