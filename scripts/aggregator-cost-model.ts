/**
 * Source-cited, integer-cent aggregator cost model for issue #24.
 *
 *     bun scripts/aggregator-cost-model.ts
 *
 * Generates the cost-model tables `docs/spikes/bank-aggregator-evaluation.md`
 * §4 pastes verbatim, and the two-axis walk-away threshold
 * `docs/decisions/0002-bank-aggregator.md` states. Every unit price below is a
 * named constant with a `// source:` URL comment; every modelling choice is a
 * named constant with an `// ASSUMPTION` comment. This split is deliberate —
 * a reader must be able to tell a measured figure from a guess at a glance,
 * and nothing in this file's output is a number that is not either one or
 * the other, labelled as such.
 *
 * Money is integer cents throughout, per CLAUDE.md ("integer minor units
 * everywhere, not one floating-point monetary value"); `formatUsd` is the
 * only place a dollar sign or a decimal point appears.
 *
 * Why a script and not a test: same reasoning as `scripts/simplefin-sandbox.ts`
 * — this is a report generator, not an assertion, and belongs beside it, run
 * the same way (`bun scripts/<name>.ts`, no `package.json` entry, precedent
 * `scripts/bakeoff-bundle.ts`).
 *
 * `scripts/` is linted (`bun run lint`) but typechecked by nothing — no
 * tsconfig's `include` matches `scripts/**`. Accepted here, matching the
 * `bakeoff-bundle.ts` precedent; written as if strict-checked anyway.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Verified unit prices — named constants, each traceable to a cited URL.
// ---------------------------------------------------------------------------

/** source: https://stripe.com/financial-connections */
const STRIPE_FC_TRANSACTIONS_CENTS_PER_INSTITUTION_MONTH = 30
/** source: https://stripe.com/financial-connections */
const STRIPE_FC_BALANCES_CENTS_PER_CALL = 10
/** source: https://stripe.com/financial-connections */
const STRIPE_FC_VERIFICATION_CENTS_PER_ACCOUNT = 150

/** source: https://teller.io/ */
const TELLER_TRANSACTIONS_CENTS_PER_ENROLLMENT_MONTH = 30
/** source: https://teller.io/ */
const TELLER_BALANCE_CENTS_PER_CALL = 10
/** source: https://teller.io/ */
const TELLER_VERIFY_CENTS_PER_ACCOUNT = 150
/** source: https://teller.io/ */
const TELLER_IDENTITY_CENTS_PER_CALL = 175
/** source: https://teller.io/ */
const TELLER_FREE_LIVE_CONNECTIONS = 100

/**
 * source: https://beta-bridge.simplefin.org/ — $15.00 + tax/yr, up to 25
 * institutions and 25 apps.
 */
const SIMPLEFIN_CENTS_PER_YEAR = 1500
/**
 * UNVERIFIED: billed to the end user, not the app. See the ADR's revert
 * trigger #1. If this flips, re-run with this constant set to
 * SIMPLEFIN_CENTS_PER_YEAR and re-decide between SimpleFIN and Stripe FC.
 */
const SIMPLEFIN_APP_SIDE_CENTS_PER_YEAR = 0

// ---------------------------------------------------------------------------
// Assumptions — named constants, each a stated modelling choice, not a
// measured figure.
// ---------------------------------------------------------------------------

/** ASSUMPTION: the four volume scenarios the issue's DoD names. */
const USER_SCENARIOS = [1, 100, 1_000, 10_000] as const
/** ASSUMPTION: one bank + one card/second bank. */
const INSTITUTIONS_PER_USER = 2
/** ASSUMPTION: the sensitivity band shown in table 2. */
const INSTITUTION_SENSITIVITY = [1, 2, 4] as const
/** ASSUMPTION: $0 / $120 / $600 / $1,200 per year — the human picks one. */
const BUDGET_SCENARIOS_CENTS = [0, 12_000, 60_000, 120_000] as const
const MONTHS_PER_YEAR = 12

function formatUsd(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100)
  const remainder = abs % 100
  return `${sign}$${dollars.toLocaleString('en-US')}.${remainder.toString().padStart(2, '0')}`
}

/** Annual app-side cost of a per-enrollment/per-institution aggregator. */
function perEnrollmentAnnualCostCents(
  users: number,
  institutionsPerUser: number,
  centsPerInstitutionMonth: number,
): number {
  return users * institutionsPerUser * centsPerInstitutionMonth * MONTHS_PER_YEAR
}

/** Teller modelled as a hard cliff: once total enrollments exceed the free tier, ALL are billed. */
function tellerConservativeAnnualCostCents(users: number, institutionsPerUser: number): number {
  const enrollments = users * institutionsPerUser
  if (enrollments <= TELLER_FREE_LIVE_CONNECTIONS) return 0
  return enrollments * TELLER_TRANSACTIONS_CENTS_PER_ENROLLMENT_MONTH * MONTHS_PER_YEAR
}

/** Teller modelled as an allowance: the first 100 enrollments stay free, only the remainder is billed. */
function tellerOptimisticAnnualCostCents(users: number, institutionsPerUser: number): number {
  const enrollments = users * institutionsPerUser
  const billable = Math.max(0, enrollments - TELLER_FREE_LIVE_CONNECTIONS)
  return billable * TELLER_TRANSACTIONS_CENTS_PER_ENROLLMENT_MONTH * MONTHS_PER_YEAR
}

interface Table1Row {
  readonly provider: string
  readonly costsByUsers: readonly number[]
}

function buildTable1(): Table1Row[] {
  return [
    {
      provider: 'simplefin (app-side)',
      costsByUsers: USER_SCENARIOS.map(() => SIMPLEFIN_APP_SIDE_CENTS_PER_YEAR),
    },
    {
      provider: 'stripe-fc',
      costsByUsers: USER_SCENARIOS.map((users) =>
        perEnrollmentAnnualCostCents(
          users,
          INSTITUTIONS_PER_USER,
          STRIPE_FC_TRANSACTIONS_CENTS_PER_INSTITUTION_MONTH,
        ),
      ),
    },
    {
      provider: 'teller (conservative)',
      costsByUsers: USER_SCENARIOS.map((users) =>
        tellerConservativeAnnualCostCents(users, INSTITUTIONS_PER_USER),
      ),
    },
    {
      provider: 'teller (optimistic)',
      costsByUsers: USER_SCENARIOS.map((users) =>
        tellerOptimisticAnnualCostCents(users, INSTITUTIONS_PER_USER),
      ),
    },
  ]
}

function renderTable1(rows: readonly Table1Row[]): string[] {
  const header = `| Provider | ${USER_SCENARIOS.map((u) => `${u.toLocaleString('en-US')} users`).join(' | ')} |`
  const separator = `|---|${USER_SCENARIOS.map(() => '---').join('|')}|`
  const lines = [header, separator]
  for (const row of rows) {
    lines.push(`| ${row.provider} | ${row.costsByUsers.map((c) => formatUsd(c)).join(' | ')} |`)
  }
  return lines
}

interface Table2Row {
  readonly provider: string
  readonly institutionsPerUser: number
  readonly costsByUsers: readonly number[]
}

function buildTable2(): Table2Row[] {
  const rows: Table2Row[] = []
  for (const institutionsPerUser of INSTITUTION_SENSITIVITY) {
    rows.push({
      provider: 'stripe-fc',
      institutionsPerUser,
      costsByUsers: USER_SCENARIOS.map((users) =>
        perEnrollmentAnnualCostCents(
          users,
          institutionsPerUser,
          STRIPE_FC_TRANSACTIONS_CENTS_PER_INSTITUTION_MONTH,
        ),
      ),
    })
  }
  for (const institutionsPerUser of INSTITUTION_SENSITIVITY) {
    rows.push({
      provider: 'teller (conservative)',
      institutionsPerUser,
      costsByUsers: USER_SCENARIOS.map((users) =>
        tellerConservativeAnnualCostCents(users, institutionsPerUser),
      ),
    })
  }
  return rows
}

function renderTable2(rows: readonly Table2Row[]): string[] {
  const header = `| Provider | Institutions/user | ${USER_SCENARIOS.map((u) => `${u.toLocaleString('en-US')} users`).join(' | ')} |`
  const separator = `|---|---|${USER_SCENARIOS.map(() => '---').join('|')}|`
  const lines = [header, separator]
  for (const row of rows) {
    lines.push(
      `| ${row.provider} | ${row.institutionsPerUser} | ${row.costsByUsers.map((c) => formatUsd(c)).join(' | ')} |`,
    )
  }
  return lines
}

interface Table3Row {
  readonly budgetCents: number
  readonly maxUsers: number
}

function buildTable3(): Table3Row[] {
  const costPerUserCentsPerYear =
    STRIPE_FC_TRANSACTIONS_CENTS_PER_INSTITUTION_MONTH * MONTHS_PER_YEAR * INSTITUTIONS_PER_USER
  return BUDGET_SCENARIOS_CENTS.map((budgetCents) => ({
    budgetCents,
    maxUsers: Math.floor(budgetCents / costPerUserCentsPerYear),
  }))
}

function renderTable3(rows: readonly Table3Row[]): string[] {
  const lines = ['| Annual budget B | Max connected users before B is exceeded |', '|---|---|']
  for (const row of rows) {
    const label = row.budgetCents === 0 ? formatUsd(0) : formatUsd(row.budgetCents)
    const value =
      row.budgetCents === 0
        ? '0 users — any connection exceeds the budget'
        : row.maxUsers.toLocaleString('en-US')
    lines.push(`| ${label} | ${value} |`)
  }
  return lines
}

function renderComplianceBlock(): string[] {
  return [
    'Compliance-scope axis (no dollar figure):',
    '- 5,000-consumer line: below it, the FTC Safeguards Rule relieves the written risk',
    '  assessment, continuous monitoring / annual pen testing, written incident response',
    '  plan and annual board report — the Rule itself still applies.',
    '  source: https://www.ftc.gov/business-guidance/resources/ftc-safeguards-rule-what-your-business-needs-know',
    '- 500-consumer breach-notification trigger: unauthorized acquisition of 500',
    "  consumers' unencrypted information must be reported to the FTC within 30 days.",
    '  source: https://www.ftc.gov/business-guidance/resources/ftc-safeguards-rule-what-your-business-needs-know',
    '- 4,000-connected-user policy gate: a policy buffer chosen in',
    '  docs/decisions/0002-bank-aggregator.md, not a legal figure — stop accepting new',
    '  bank connections at 4,000 unless the full nine-element Safeguards Rule program is',
    '  in place.',
    '',
    'Not monetized on purpose — see docs/spikes/bank-aggregator-evaluation.md §7. This',
    'spike does not price counsel time, and inventing a figure would be the exact',
    'failure it exists to prevent.',
  ]
}

/**
 * The non-transaction unit prices — verification, balance, identity — quoted
 * here so the spike doc's matrix row 2 ("Other unit prices") can cite this
 * script's output rather than retyping the source-cited constants above.
 */
function renderOtherUnitPrices(): string[] {
  return [
    '## Other unit prices (not part of the annual cost model above)',
    '',
    '| Provider | Verification | Balance | Identity |',
    '|---|---|---|---|',
    `| stripe-fc | ${formatUsd(STRIPE_FC_VERIFICATION_CENTS_PER_ACCOUNT)}/account | ${formatUsd(STRIPE_FC_BALANCES_CENTS_PER_CALL)}/call | — |`,
    `| teller | ${formatUsd(TELLER_VERIFY_CENTS_PER_ACCOUNT)}/account | ${formatUsd(TELLER_BALANCE_CENTS_PER_CALL)}/call | ${formatUsd(TELLER_IDENTITY_CENTS_PER_CALL)}/call |`,
  ]
}

function main(): void {
  const table1Rows = buildTable1()
  const table2Rows = buildTable2()
  const table3Rows = buildTable3()

  const output: string[] = []
  output.push(...renderOtherUnitPrices())
  output.push('')
  output.push('## Table 1 — app-side annual cost by provider × connected users')
  output.push(`(institutions per user = ${INSTITUTIONS_PER_USER}, an ASSUMPTION)`)
  output.push('')
  output.push(...renderTable1(table1Rows))
  output.push('')
  output.push('## Table 2 — sensitivity to institutions per user')
  output.push('')
  output.push(...renderTable2(table2Rows))
  output.push('')
  output.push('## Table 3 — cost-axis walk-away trigger')
  output.push(
    `(30¢/enrollment/month aggregator at ${INSTITUTIONS_PER_USER} institutions/user, an ASSUMPTION)`,
  )
  output.push('')
  output.push(...renderTable3(table3Rows))
  output.push('')
  output.push(...renderComplianceBlock())
  output.push('')
  output.push(
    `SimpleFIN end-user cost (separately labelled, never confused with an app-side cost): ${formatUsd(SIMPLEFIN_CENTS_PER_YEAR)}/user/yr, billed to the end user — UNVERIFIED billing party`,
  )

  const text = output.join('\n')
  console.log(text)

  const json = {
    generatedBy: 'scripts/aggregator-cost-model.ts',
    userScenarios: USER_SCENARIOS,
    institutionsPerUser: INSTITUTIONS_PER_USER,
    institutionSensitivity: INSTITUTION_SENSITIVITY,
    budgetScenariosCents: BUDGET_SCENARIOS_CENTS,
    table1: table1Rows,
    table2: table2Rows,
    table3: table3Rows,
    simplefinEndUserCentsPerYear: SIMPLEFIN_CENTS_PER_YEAR,
    simplefinAppSideCentsPerYear: SIMPLEFIN_APP_SIDE_CENTS_PER_YEAR,
  }
  const outDir = join(import.meta.dirname, '../.claude/runway-runner/tasks/24')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'cost-model.json'), JSON.stringify(json, null, 2))
}

main()
