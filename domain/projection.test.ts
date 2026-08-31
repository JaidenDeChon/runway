import { describe, expect, it } from 'vitest'
import { addDays, daysBetween } from './dates'
import { toMinorUnits } from './money'
import {
  canAnswerShortfall,
  classifyMargin,
  evaluate,
  occurrencesIn,
  project,
  shortfallThrough,
  signedAmount,
  TIGHT_THRESHOLD,
  upcomingBills,
} from './projection'
import { createSeedData, SEED_TODAY } from './seed'
import type { Account, RecurringItem, RunwayData, Transfer } from './types'

const account = (over: Partial<Account> = {}): Account => ({
  id: 'a',
  name: 'A',
  balance: toMinorUnits(1000),
  balanceAsOf: SEED_TODAY,
  color: 'chart-3',
  isDiscretionarySource: false,
  ...over,
})

const item = (over: Partial<RecurringItem> = {}): RecurringItem => ({
  id: 'i',
  name: 'Item',
  kind: 'bill',
  amount: toMinorUnits(100),
  cadence: 'monthly',
  accountId: 'a',
  nextOccurrence: '2026-08-20',
  amountSource: 'fixed',
  depositHistory: [],
  isVariable: false,
  ...over,
})

const data = (over: Partial<RunwayData> = {}): RunwayData => ({
  accounts: [account()],
  recurringItems: [],
  transfers: [],
  monthlyDiscretionarySpend: 0,
  safetyCushion: 0,
  timeZone: null,
  ...over,
})

describe('signedAmount', () => {
  it('is positive for income and negative for a bill, both from a positive stored magnitude', () => {
    expect(signedAmount(item({ kind: 'income', amount: toMinorUnits(500) }))).toBe(
      toMinorUnits(500),
    )
    expect(signedAmount(item({ kind: 'bill', amount: toMinorUnits(500) }))).toBe(toMinorUnits(-500))
  })
})

describe('project', () => {
  it('holds the balance flat when nothing is scheduled', () => {
    const result = project(data(), { start: SEED_TODAY, end: addDays(SEED_TODAY, 3) })
    expect(result.combined.map((point) => point.balance)).toEqual([
      toMinorUnits(1000),
      toMinorUnits(1000),
      toMinorUnits(1000),
      toMinorUnits(1000),
    ])
  })

  it('treats the as-of reading as already including that day', () => {
    // A bill on the as-of date itself must not be deducted a second time.
    const result = project(data({ recurringItems: [item({ nextOccurrence: SEED_TODAY })] }), {
      start: SEED_TODAY,
      end: SEED_TODAY,
    })
    expect(result.combined[0]?.balance).toBe(toMinorUnits(1000))
  })

  it('subtracts bills and adds income on their occurrence days', () => {
    const result = project(
      data({
        recurringItems: [
          item({ id: 'bill', nextOccurrence: addDays(SEED_TODAY, 1) }),
          item({
            id: 'pay',
            kind: 'income',
            amount: toMinorUnits(250),
            nextOccurrence: addDays(SEED_TODAY, 2),
          }),
        ],
      }),
      { start: SEED_TODAY, end: addDays(SEED_TODAY, 2) },
    )
    expect(result.combined.map((point) => point.balance)).toEqual([
      toMinorUnits(1000),
      toMinorUnits(900),
      toMinorUnits(1150),
    ])
  })

  it('integrates backwards for days before the as-of reading', () => {
    // Yesterday's balance must be *higher* than today's when a bill landed
    // today — walking backwards subtracts the delta rather than adding it.
    const result = project(data({ recurringItems: [item({ nextOccurrence: SEED_TODAY })] }), {
      start: addDays(SEED_TODAY, -2),
      end: SEED_TODAY,
    })
    expect(result.combined.map((point) => point.balance)).toEqual([
      toMinorUnits(1100),
      toMinorUnits(1100),
      toMinorUnits(1000),
    ])
  })

  it('drains the daily discretionary spend from the source account only', () => {
    // $310 across a 31-day August is exactly $10 a day, which is the only reason
    // the expected balances below are round numbers.
    const result = project(
      data({
        accounts: [
          account({ id: 'a', isDiscretionarySource: true }),
          account({ id: 'b', balance: toMinorUnits(500) }),
        ],
        monthlyDiscretionarySpend: toMinorUnits(310),
      }),
      { start: SEED_TODAY, end: addDays(SEED_TODAY, 2) },
    )
    const [source, other] = result.byAccount
    expect(source?.points.map((point) => point.balance)).toEqual([
      toMinorUnits(1000),
      toMinorUnits(990),
      toMinorUnits(980),
    ])
    expect(other?.points.every((point) => point.balance === toMinorUnits(500))).toBe(true)
  })

  it('restricts the projection to the requested accounts', () => {
    const result = project(
      data({ accounts: [account({ id: 'a' }), account({ id: 'b', balance: toMinorUnits(7) })] }),
      { start: SEED_TODAY, end: SEED_TODAY, accountIds: ['b'] },
    )
    expect(result.byAccount).toHaveLength(1)
    expect(result.combined[0]?.balance).toBe(toMinorUnits(7))
  })

  it('excludes an archived account even when its id is named in accountIds', () => {
    // The seam should never hand an archived account over, but the engine
    // refuses it anyway — naming its id must not resurrect it in a forecast.
    const result = project(
      data({
        accounts: [
          account({ id: 'a' }),
          account({ id: 'gone', balance: toMinorUnits(7), archivedOn: SEED_TODAY }),
        ],
      }),
      { start: SEED_TODAY, end: SEED_TODAY, accountIds: ['a', 'gone'] },
    )
    expect(result.byAccount.map((series) => series.accountId)).toEqual(['a'])
    expect(result.combined[0]?.balance).toBe(toMinorUnits(1000))
  })
})

describe('transfers are balance-neutral', () => {
  it('leaves the combined series identical', () => {
    const transfer: Transfer = {
      id: 't',
      fromAccountId: 'a',
      toAccountId: 'b',
      amount: toMinorUnits(400),
      date: addDays(SEED_TODAY, 1),
      createdAt: 1,
    }
    const accounts = [account({ id: 'a' }), account({ id: 'b', balance: toMinorUnits(500) })]
    const window = { start: SEED_TODAY, end: addDays(SEED_TODAY, 2) }

    const without = project(data({ accounts }), window)
    const with_ = project(data({ accounts, transfers: [transfer] }), window)

    expect(with_.combined).toEqual(without.combined)
  })

  it('still moves the individual account balances', () => {
    const transfer: Transfer = {
      id: 't',
      fromAccountId: 'a',
      toAccountId: 'b',
      amount: toMinorUnits(400),
      date: addDays(SEED_TODAY, 1),
      createdAt: 1,
    }
    const result = project(
      data({
        accounts: [account({ id: 'a' }), account({ id: 'b', balance: toMinorUnits(500) })],
        transfers: [transfer],
      }),
      { start: SEED_TODAY, end: addDays(SEED_TODAY, 1) },
    )
    expect(result.byAccount[0]?.points[1]?.balance).toBe(toMinorUnits(600))
    expect(result.byAccount[1]?.points[1]?.balance).toBe(toMinorUnits(900))
  })

  it('never registers as income or spending', () => {
    const result = occurrencesIn(
      data({
        transfers: [
          {
            id: 't',
            fromAccountId: 'a',
            toAccountId: 'b',
            amount: toMinorUnits(400),
            date: SEED_TODAY,
            createdAt: 1,
          },
        ],
      }),
      { start: SEED_TODAY, end: SEED_TODAY },
    )
    expect(result).toEqual([])
  })
})

describe('events between a stale reading and the window', () => {
  const onceOn = (date: string, over: Partial<RecurringItem>): RecurringItem =>
    item({ nextOccurrence: date, startsOn: date, endsOn: date, ...over })

  it('applies them, even though none of them is drawn', () => {
    // The reading is true as of 2026-05-01 and already contains that day. The
    // window opens two weeks later, so everything in between is integrated
    // across without ever appearing on the chart — and if it were dropped, the
    // opening balance would be too high by exactly the events nobody can see.
    const data_ = data({
      accounts: [
        account({
          id: 'a',
          balance: toMinorUnits(5000),
          balanceAsOf: '2026-05-01',
          isDiscretionarySource: true,
        }),
      ],
      recurringItems: [
        onceOn('2026-05-05', { id: 'rent', amount: toMinorUnits(1200) }),
        onceOn('2026-05-10', { id: 'pay', kind: 'income', amount: toMinorUnits(3000) }),
      ],
      monthlyDiscretionarySpend: toMinorUnits(1000),
    })
    const result = project(data_, { start: '2026-05-15', end: '2026-05-16' })

    // 14 drained days (the 2nd through the 15th) at 3226c — May has 31 days, so
    // the remainder of 25 puts the 1st through the 25th one cent above the share.
    const drained = 14 * 3226
    expect(result.combined[0]?.balance).toBe(
      toMinorUnits(5000) - drained - toMinorUnits(1200) + toMinorUnits(3000),
    )
    // Neither of them is an occurrence of this window; they moved the opening
    // balance and left no other trace.
    expect(result.occurrences).toEqual([])
  })

  it('would report a balance that is too high if they were dropped', () => {
    // The same portfolio with the gap emptied. If the engine ever stopped
    // integrating the gap, the test above would produce this number instead —
    // which is the app telling someone they have $1,651.64 they do not have.
    const withoutGap = project(
      data({
        accounts: [account({ id: 'a', balance: toMinorUnits(5000), balanceAsOf: '2026-05-01' })],
      }),
      { start: '2026-05-15', end: '2026-05-16' },
    )
    expect(withoutGap.combined[0]?.balance).toBe(toMinorUnits(5000))
  })
})

describe('a stale reading breaks transfer neutrality, and that is correct', () => {
  it('moves the combined line when the two legs straddle their as-of readings', () => {
    // Checking was last read *today*, so today's activity is already inside its
    // $1,000. Savings was last read five days ago, so it is not inside its $500.
    // A transfer between them today is therefore counted once, not twice — and
    // the combined line legitimately drops by it.
    //
    // This is not the engine losing money. It is two readings taken on
    // different days disagreeing about whether the transfer has happened yet,
    // and the honest total is the one that believes the fresher reading.
    const straddling = data({
      accounts: [
        account({ id: 'checking', balance: toMinorUnits(1000), balanceAsOf: SEED_TODAY }),
        account({ id: 'savings', balance: toMinorUnits(500), balanceAsOf: '2026-08-10' }),
      ],
      transfers: [
        {
          id: 'x',
          fromAccountId: 'savings',
          toAccountId: 'checking',
          amount: toMinorUnits(100),
          date: SEED_TODAY,
          createdAt: 1,
        },
      ],
    })
    const window = { start: SEED_TODAY, end: SEED_TODAY }
    const without = project({ ...straddling, transfers: [] }, window)
    const withIt = project(straddling, window)

    expect(without.combined[0]?.balance).toBe(toMinorUnits(1500))
    expect(withIt.combined[0]?.balance).toBe(toMinorUnits(1400))
    // Checking already had it; savings had not yet paid it.
    expect(withIt.byAccount[0]?.points[0]?.balance).toBe(toMinorUnits(1000))
    expect(withIt.byAccount[1]?.points[0]?.balance).toBe(toMinorUnits(400))
  })

  it('is neutral again once the transfer post-dates both readings', () => {
    const clean = data({
      accounts: [
        account({ id: 'checking', balance: toMinorUnits(1000) }),
        account({ id: 'savings', balance: toMinorUnits(500) }),
      ],
      transfers: [
        {
          id: 'x',
          fromAccountId: 'savings',
          toAccountId: 'checking',
          amount: toMinorUnits(100),
          date: addDays(SEED_TODAY, 1),
          createdAt: 1,
        },
      ],
    })
    const window = { start: SEED_TODAY, end: addDays(SEED_TODAY, 2) }
    expect(project(clean, window).combined.map((point) => point.balance)).toEqual(
      project({ ...clean, transfers: [] }, window).combined.map((point) => point.balance),
    )
  })
})

describe('the low point, found in the same walk as the series', () => {
  /** A one-off event: a monthly rule whose window is a single day. */
  const onceOn = (date: string, over: Partial<RecurringItem>): RecurringItem =>
    item({ nextOccurrence: date, startsOn: date, endsOn: date, ...over })

  // 15th: $1,000. 16th: +$400. 17th: −$200. 18th: flat.
  //   -> 1000, 1400, 1200, 1200
  const dipping = data({
    recurringItems: [
      onceOn('2026-08-16', { id: 'up', kind: 'income', amount: toMinorUnits(400) }),
      onceOn('2026-08-17', { id: 'down', kind: 'bill', amount: toMinorUnits(200) }),
    ],
  })
  const window = { start: SEED_TODAY, end: '2026-08-18' }

  it('searches the whole window when verdictFrom is left to default', () => {
    const { combinedSummary } = project(dipping, window)
    expect(combinedSummary.lowest).toEqual({ date: SEED_TODAY, balance: toMinorUnits(1000) })
  })

  it('ignores days before verdictFrom, because a past dip is not a forecast', () => {
    const { combinedSummary } = project(dipping, { ...window, verdictFrom: '2026-08-16' })
    expect(combinedSummary.lowest).toEqual({ date: '2026-08-17', balance: toMinorUnits(1200) })
  })

  it('resolves ties to the earliest date, the one still worth acting on', () => {
    const { combinedSummary } = project(dipping, { ...window, verdictFrom: '2026-08-16' })
    // The 17th and the 18th are both $1,200; the 17th wins.
    expect(combinedSummary.lowest?.date).toBe('2026-08-17')
  })

  it('treats a verdictFrom before the window as the window itself', () => {
    const { combinedSummary } = project(dipping, { ...window, verdictFrom: '2020-01-01' })
    expect(combinedSummary.lowest).toEqual({ date: SEED_TODAY, balance: toMinorUnits(1000) })
  })

  it('has no low point when verdictFrom leaves no future to search', () => {
    const { combinedSummary } = project(dipping, {
      start: SEED_TODAY,
      end: SEED_TODAY,
      verdictFrom: addDays(SEED_TODAY, 1),
    })
    expect(combinedSummary.lowest).toBeNull()
  })

  it('reports the closing balance alongside it, from that same walk', () => {
    const { combinedSummary, byAccount } = project(dipping, window)
    expect(combinedSummary.ending).toBe(toMinorUnits(1200))
    expect(byAccount[0]?.summary.ending).toBe(toMinorUnits(1200))
  })

  it('finds the combined low point on a day no single account bottoms out', () => {
    // A dips on the 16th, B on the 17th; together they are lowest on neither.
    const two = data({
      accounts: [
        account({ id: 'a', balance: toMinorUnits(1000) }),
        account({ id: 'b', balance: toMinorUnits(1000) }),
      ],
      recurringItems: [
        onceOn('2026-08-16', { id: 'a-bill', accountId: 'a', amount: toMinorUnits(300) }),
        onceOn('2026-08-17', { id: 'b-bill', accountId: 'b', amount: toMinorUnits(300) }),
      ],
    })
    const { byAccount, combinedSummary } = project(two, window)
    expect(byAccount[0]?.summary.lowest?.date).toBe('2026-08-16')
    expect(byAccount[1]?.summary.lowest?.date).toBe('2026-08-17')
    // Both bills have landed by the 17th: 2000 − 300 − 300.
    expect(combinedSummary.lowest).toEqual({ date: '2026-08-17', balance: toMinorUnits(1400) })
  })
})

describe('classifyMargin', () => {
  it('treats the $250 boundary as covered, not tight', () => {
    expect(classifyMargin(TIGHT_THRESHOLD)).toBe('covered')
    expect(classifyMargin(TIGHT_THRESHOLD - 1)).toBe('tight')
  })

  it('treats exactly meeting the cushion as tight, not short', () => {
    expect(classifyMargin(0)).toBe('tight')
    expect(classifyMargin(-1)).toBe('short')
  })
})

describe('evaluate', () => {
  it('reports the shortfall as a negative margin', () => {
    const verdict = evaluate(
      { lowest: { date: '2026-08-16', balance: toMinorUnits(4886) }, ending: toMinorUnits(4886) },
      toMinorUnits(6000),
    )
    expect(verdict.status).toBe('short')
    expect(verdict.isCovered).toBe(false)
    expect(verdict.margin).toBe(toMinorUnits(-1114))
  })

  it('treats a window with no future in it as meeting nothing but zero', () => {
    // No low point is not the same as a low point of zero, but the verdict has
    // to say something: with nothing ahead, the margin is the cushion itself.
    const verdict = evaluate({ lowest: null, ending: toMinorUnits(5000) }, toMinorUnits(600))
    expect(verdict.lowest).toBeNull()
    expect(verdict.margin).toBe(toMinorUnits(-600))
  })
})

describe('upcomingBills', () => {
  const seeded = createSeedData()

  it('excludes income', () => {
    expect(upcomingBills(seeded, SEED_TODAY).some((bill) => bill.label === 'Paycheck')).toBe(false)
  })

  it('lists only the next occurrence of each bill', () => {
    const bills = upcomingBills(seeded, SEED_TODAY)
    expect(new Set(bills.map((bill) => bill.itemId)).size).toBe(bills.length)
  })

  it('respects the horizon', () => {
    expect(upcomingBills(seeded, SEED_TODAY, 6).map((bill) => bill.label)).toEqual(['Car payment'])
  })

  it('excludes today, so every bill is genuinely upcoming', () => {
    const bills = upcomingBills(seeded, SEED_TODAY)
    expect(bills.every((bill) => daysBetween(SEED_TODAY, bill.date) >= 1)).toBe(true)
  })

  it('is sorted by date ascending', () => {
    const dates = upcomingBills(seeded, SEED_TODAY).map((bill) => bill.date)
    expect([...dates].sort()).toEqual(dates)
  })
})

describe('canAnswerShortfall', () => {
  it('refuses the household that made this rule necessary: an account, $0, nothing scheduled', () => {
    const household = data({ accounts: [account({ balance: 0 })] })
    expect(canAnswerShortfall(household)).toBe(false)

    // …and this is precisely what it is refusing to let the screen show. The
    // engine is not wrong; it is being asked a question with no content.
    const answer = shortfallThrough(household, {
      today: SEED_TODAY,
      through: addDays(SEED_TODAY, 30),
      cushion: 0,
    })
    expect(answer.isCovered).toBe(true)
  })

  it('refuses a household with no account at all', () => {
    expect(canAnswerShortfall(data({ accounts: [] }))).toBe(false)
    expect(canAnswerShortfall(data({ accounts: [], recurringItems: [item()] }))).toBe(false)
  })

  it('refuses a household whose only accounts are archived', () => {
    expect(
      canAnswerShortfall(
        data({
          accounts: [account({ archivedOn: SEED_TODAY })],
          recurringItems: [item()],
        }),
      ),
    ).toBe(false)
  })

  it('answers once there is a bill to be short against', () => {
    expect(canAnswerShortfall(data({ recurringItems: [item({ kind: 'bill' })] }))).toBe(true)
  })

  it('does not count income alone — a forecast that only goes up is not the question', () => {
    expect(canAnswerShortfall(data({ recurringItems: [item({ kind: 'income' })] }))).toBe(false)
  })

  it('counts a bill beyond the 120-day bill picker, which is a different question', () => {
    const faraway = addDays(SEED_TODAY, 200)
    const household = data({
      recurringItems: [item({ nextOccurrence: faraway, cadence: 'annual' })],
    })
    expect(upcomingBills(household, SEED_TODAY)).toHaveLength(0)
    expect(canAnswerShortfall(household)).toBe(true)
  })

  it('counts a discretionary drain, but only one that has an account to drain', () => {
    // Mirrors `project`'s own condition: a monthly figure with no source
    // account spends nothing, so it is not information either.
    const withSource = data({
      accounts: [account({ isDiscretionarySource: true })],
      monthlyDiscretionarySpend: toMinorUnits(600),
    })
    expect(canAnswerShortfall(withSource)).toBe(true)

    const noSource = data({
      accounts: [account({ isDiscretionarySource: false })],
      monthlyDiscretionarySpend: toMinorUnits(600),
    })
    expect(canAnswerShortfall(noSource)).toBe(false)

    const noSpend = data({
      accounts: [account({ isDiscretionarySource: true })],
      monthlyDiscretionarySpend: 0,
    })
    expect(canAnswerShortfall(noSpend)).toBe(false)
  })

  it('is unmoved by transfers, which are balance-neutral by construction', () => {
    const transfer: Transfer = {
      id: 't',
      fromAccountId: 'a',
      toAccountId: 'b',
      amount: toMinorUnits(100),
      date: SEED_TODAY,
      createdAt: 0,
    }
    expect(
      canAnswerShortfall(
        data({ accounts: [account({ id: 'a' }), account({ id: 'b' })], transfers: [transfer] }),
      ),
    ).toBe(false)
  })
})

describe('shortfallThrough', () => {
  /** A one-off event: a monthly rule whose window is a single day. */
  const onceOn = (date: string, over: Partial<RecurringItem>): RecurringItem =>
    item({ nextOccurrence: date, startsOn: date, endsOn: date, ...over })

  // Rent on the 18th empties the account; the paycheck on the 25th refills it.
  // Ask about the 30th and the closing balance looks healthy — but the 18th
  // through the 24th are spent under the cushion.
  const dipping = data({
    accounts: [account({ balance: toMinorUnits(2000) })],
    recurringItems: [
      onceOn('2026-08-18', { id: 'rent', name: 'Rent', amount: toMinorUnits(1800) }),
      onceOn('2026-08-25', {
        id: 'pay',
        name: 'Paycheck',
        kind: 'income',
        amount: toMinorUnits(2500),
      }),
    ],
  })

  it('reports a mid-window dip the endpoint balance hides', () => {
    const answer = shortfallThrough(dipping, {
      today: SEED_TODAY,
      through: '2026-08-30',
      cushion: toMinorUnits(600),
    })
    // $2,700 on the last day — comfortably above a $600 cushion.
    expect(answer.endingBalance).toBe(toMinorUnits(2700))
    // And yet.
    expect(answer.isCovered).toBe(false)
    expect(answer.lowest).toEqual({ date: '2026-08-18', balance: toMinorUnits(200) })
    expect(answer.shortfall).toBe(toMinorUnits(400))
  })

  it('is the amount that would actually fix the dip', () => {
    const question = { today: SEED_TODAY, through: '2026-08-30', cushion: toMinorUnits(600) }
    const short = shortfallThrough(dipping, question)
    const topped = data({
      ...dipping,
      accounts: [account({ balance: toMinorUnits(2000) + short.shortfall })],
    })
    const after = shortfallThrough(topped, question)
    expect(after.isCovered).toBe(true)
    expect(after.shortfall).toBe(0)
    // Exactly enough, not more: the low point now sits *on* the cushion.
    expect(after.lowest?.balance).toBe(toMinorUnits(600))
  })

  it('counts today, unlike the dashboard verdict', () => {
    const answer = shortfallThrough(data({ accounts: [account({ balance: toMinorUnits(100) })] }), {
      today: SEED_TODAY,
      through: '2026-08-30',
      cushion: toMinorUnits(600),
    })
    expect(answer.lowest?.date).toBe(SEED_TODAY)
    expect(answer.startingBalance).toBe(toMinorUnits(100))
  })

  it('raises a target in the past to today rather than inverting the window', () => {
    const answer = shortfallThrough(data(), {
      today: SEED_TODAY,
      through: '2026-01-01',
      cushion: toMinorUnits(600),
    })
    expect(answer.through).toBe(SEED_TODAY)
    expect(answer.lowest).toEqual({ date: SEED_TODAY, balance: toMinorUnits(1000) })
    expect(answer.isCovered).toBe(true)
  })

  it('is covered when nothing is scheduled and the balance already clears', () => {
    const answer = shortfallThrough(data(), {
      today: SEED_TODAY,
      through: addDays(SEED_TODAY, 90),
      cushion: toMinorUnits(600),
    })
    expect(answer.status).toBe('covered')
    expect(answer.shortfall).toBe(0)
    expect(answer.endingBalance).toBe(toMinorUnits(1000))
  })
})
