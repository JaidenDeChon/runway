/**
 * Live SimpleFIN Bridge sandbox connection — issue #24's sandbox proof.
 *
 *     bun scripts/simplefin-sandbox.ts
 *
 * This is issue #24's demonstrated sandbox connection: it claims a fresh
 * public demo token from SimpleFIN Bridge's developer page, exchanges it for
 * an access URL, fetches `/accounts`, and prints the response *shape* — key
 * names, value types, counts — never a balance, a credential or any
 * transaction field value. It exists to give `docs/spikes/bank-aggregator-evaluation.md`
 * a real, reproducible transcript instead of a claim about one.
 *
 * Why a script and not a Vitest test: it makes real network calls against a
 * third party. `vitest.config.ts`'s `unit` project (the only project that
 * runs with no live stack) matches `app/lib/**`, `app/utils/**`, `shared/**`,
 * `domain/**`, `tests/domain/**` and `tests/guards/**` — it does not match
 * `scripts/**`, and it must not be made to: a network call inside a suite
 * that is supposed to pass offline is a defect, not a feature. Precedent:
 * `scripts/bakeoff-bundle.ts`, run the same way and for the same reason.
 *
 * `scripts/` is linted (`bun run lint` / `biome ci .` covers `**` with no
 * `scripts/` exclusion) but typechecked by nothing — no tsconfig's `include`
 * matches `scripts/**`. That gap is accepted here, matching the
 * `bakeoff-bundle.ts` precedent; this file is written as if it were
 * strict-checked anyway.
 *
 * Redaction contract: every line is collected into a buffer and nothing is
 * written to stdout or to disk until `assertNoSecrets` has scanned the joined
 * transcript for every credential this run ever saw — the raw setup token,
 * the decoded claim URL, the claim token's path segment, the access URL, and
 * its username/password. The same check gates the error path: a thrown
 * error's message is scanned before it is printed. This makes redaction
 * structural, not a matter of remembering not to print something.
 *
 * `SIMPLEFIN_ACCESS_URL` (optional): a real SimpleFIN Bridge access URL,
 * letting someone with an actual account skip the demo-token dance. Its
 * value is a credential and is never printed. This is a developer-only
 * variable read by this script, not by the running app, so it is
 * deliberately absent from `.env.example` — see `README.md`'s rule that
 * every variable the app reads is listed there in the same change that
 * starts reading it.
 *
 * The float/truncation finding below is quoted verbatim from
 * `.claude/runway-runner/tasks/24/research-dossier.md` (gitignored working
 * data) because it is measured, not asserted, and restating it in different
 * words risks overclaiming:
 *
 * > `Math.round(parseFloat(v)*100)` is exact for `|amount| < 90071992547409`
 * > — i.e. it is *not* wrong at any realistic magnitude. **Do not claim it
 * > is.** It *does* silently collapse sub-cent precision: `1.005 -> 100`
 * > ($1.00, not $1.01). A string-based parser is still the correct answer,
 * > but the honest justification is sub-cent precision and auditability,
 * > **not** "floats break at $19.99 with rounding."
 */

import { Buffer } from 'node:buffer'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { todayIn } from '../domain/dates'

const DEVELOPERS_PAGE = 'https://beta-bridge.simplefin.org/info/developers'
const CLAIM_URL_PATTERN = /^https:\/\/\S+\/simplefin\/claim\//

const TRANSCRIPT_PATH = join(
  import.meta.dirname,
  '../.claude/runway-runner/tasks/24/sandbox-transcript.txt',
)

function assertNoSecrets(transcript: string, secrets: readonly string[]): void {
  for (const secret of secrets) {
    if (secret === '') continue
    if (transcript.includes(secret)) {
      throw new Error(
        'Redaction check failed: the transcript contains a credential. Nothing was printed or written.',
      )
    }
  }
}

function formatUnixSecondsCount(min: number, max: number, count: number): string {
  const days = Math.round((max - min) / 86400)
  return `transaction span: ${days} days across ${count} transactions`
}

interface FieldTypeCheck {
  readonly field: string
  readonly type: string
  readonly matching: number
  readonly total: number
  readonly checkDot: boolean
  readonly dotCount: number
}

// Module-scope so the top-level catch handler can run the same redaction
// check over an error message using whatever secrets main() had already
// accumulated at the point of failure.
const secrets: string[] = []

async function main(): Promise<void> {
  const lines: string[] = []

  let accessUrl: string

  const envAccessUrl = process.env.SIMPLEFIN_ACCESS_URL?.trim()
  if (envAccessUrl) {
    lines.push('Using SIMPLEFIN_ACCESS_URL from the environment (the value is never printed).')
    secrets.push(envAccessUrl)
    accessUrl = envAccessUrl
  } else {
    // Step 2: fetch the developer page.
    const pageResponse = await fetch(DEVELOPERS_PAGE)
    if (!pageResponse.ok) {
      throw new Error(`GET ${DEVELOPERS_PAGE} -> ${pageResponse.status}`)
    }
    const html = await pageResponse.text()
    const byteLength = Buffer.byteLength(html, 'utf8')
    lines.push(`[1/3] GET ${DEVELOPERS_PAGE} -> ${pageResponse.status} (${byteLength} bytes)`)

    // Step 3: scrape the setup token. Confirmed against the live page: a
    // 104-char base64 string inside a <pre class="code"> block that decodes
    // to https://beta-bridge.simplefin.org/simplefin/claim/DEMO-v2-<HEX>.
    const candidates = html.match(/[A-Za-z0-9+/=]{40,}/g) ?? []
    let claimUrl: string | null = null
    let rawToken: string | null = null
    for (const candidate of candidates) {
      let decoded: string
      try {
        decoded = Buffer.from(candidate, 'base64').toString('utf8')
      } catch {
        continue
      }
      if (CLAIM_URL_PATTERN.test(decoded)) {
        claimUrl = decoded
        rawToken = candidate
        break
      }
    }
    if (!claimUrl || !rawToken) {
      throw new Error(
        `No SimpleFIN setup token found on ${DEVELOPERS_PAGE}. The page layout may have changed; re-check it by hand.`,
      )
    }
    secrets.push(rawToken, claimUrl)
    const claimUrlOrigin = new URL(claimUrl).origin
    lines.push(
      `[1/3] setup token found: ${rawToken.length} chars, decodes to ${claimUrlOrigin}/simplefin/claim/<redacted>`,
    )

    // Step 4: POST the claim URL to exchange for an access URL.
    const claimResponse = await fetch(claimUrl, { method: 'POST', body: '' })
    if (claimResponse.status === 403) {
      lines.push(
        '[2/3] POST claim URL -> 403 (Forbidden — claim tokens are single-use). Re-run to mint a fresh demo token.',
      )
      assertNoSecrets(lines.join('\n'), secrets)
      mkdirSync(join(import.meta.dirname, '../.claude/runway-runner/tasks/24'), {
        recursive: true,
      })
      const transcript = lines.join('\n')
      writeFileSync(TRANSCRIPT_PATH, transcript)
      console.log(transcript)
      process.exitCode = 1
      return
    }
    if (claimResponse.status !== 200) {
      throw new Error(`POST claim URL -> ${claimResponse.status}`)
    }
    const claimBody = (await claimResponse.text()).trim()
    const parsedAccessUrl = new URL(claimBody)
    if (parsedAccessUrl.username === '') {
      throw new Error('Claim returned a body that is not a credentialed access URL.')
    }
    secrets.push(claimBody, parsedAccessUrl.username, parsedAccessUrl.password)
    lines.push(
      `[2/3] POST claim URL -> 200; access URL received: https://<redacted>@${parsedAccessUrl.host}${parsedAccessUrl.pathname}`,
    )
    accessUrl = claimBody
  }

  // Step 5: fetch /accounts, sending credentials as an explicit Basic auth
  // header rather than inline in the URL — unambiguous across runtimes.
  const u = new URL(accessUrl)
  const username = decodeURIComponent(u.username)
  const password = decodeURIComponent(u.password)
  secrets.push(username, password)
  const auth = Buffer.from(`${username}:${password}`).toString('base64')
  u.username = ''
  u.password = ''
  const accountsUrl = `${u.toString().replace(/\/$/, '')}/accounts`
  const accountsResponse = await fetch(accountsUrl, {
    headers: { Authorization: `Basic ${auth}` },
  })
  const accountsBodyText = await accountsResponse.text()
  const accountsByteLength = Buffer.byteLength(accountsBodyText, 'utf8')
  if (accountsResponse.status !== 200) {
    throw new Error(`GET /accounts -> ${accountsResponse.status}`)
  }
  lines.push(
    `[3/3] GET ${u.host}${u.pathname}/accounts -> ${accountsResponse.status} (${accountsByteLength} bytes)`,
  )

  const body = JSON.parse(accountsBodyText) as Record<string, unknown>
  const accounts = Array.isArray(body.accounts) ? (body.accounts as Record<string, unknown>[]) : []

  // Step 6: report the response shape only.
  lines.push(`top-level keys: ${Object.keys(body).sort().join(', ')}`)
  lines.push(`accounts: ${accounts.length}`)

  const accountKeys = new Set<string>()
  const orgKeys = new Set<string>()
  const transactionKeys = new Set<string>()
  const transactionCounts: number[] = []
  const currencies: string[] = []
  let transactedTimestampMin = Number.POSITIVE_INFINITY
  let transactedTimestampMax = Number.NEGATIVE_INFINITY
  let transactedCount = 0

  const fieldChecks: Record<string, { types: Map<string, number>; total: number; dots: number }> = {
    balance: { types: new Map(), total: 0, dots: 0 },
    'available-balance': { types: new Map(), total: 0, dots: 0 },
    'balance-date': { types: new Map(), total: 0, dots: 0 },
    amount: { types: new Map(), total: 0, dots: 0 },
    posted: { types: new Map(), total: 0, dots: 0 },
    transacted_at: { types: new Map(), total: 0, dots: 0 },
  }

  function recordField(field: string, value: unknown): void {
    const check = fieldChecks[field]
    if (!check) return
    check.total += 1
    const type = typeof value
    check.types.set(type, (check.types.get(type) ?? 0) + 1)
    if (type === 'string' && (value as string).includes('.')) {
      check.dots += 1
    }
  }

  for (const account of accounts) {
    for (const key of Object.keys(account)) accountKeys.add(key)
    recordField('balance', account.balance)
    recordField('available-balance', account['available-balance'])
    recordField('balance-date', account['balance-date'])
    if (typeof account.currency === 'string') currencies.push(account.currency)
    const org = account.org as Record<string, unknown> | undefined
    if (org && typeof org === 'object') {
      for (const key of Object.keys(org)) orgKeys.add(key)
    }
    const transactions = Array.isArray(account.transactions)
      ? (account.transactions as Record<string, unknown>[])
      : []
    transactionCounts.push(transactions.length)
    for (const tx of transactions) {
      for (const key of Object.keys(tx)) transactionKeys.add(key)
      recordField('amount', tx.amount)
      recordField('posted', tx.posted)
      recordField('transacted_at', tx.transacted_at)
      if (typeof tx.posted === 'number') {
        transactedTimestampMin = Math.min(transactedTimestampMin, tx.posted)
        transactedTimestampMax = Math.max(transactedTimestampMax, tx.posted)
        transactedCount += 1
      }
    }
  }

  lines.push(`account keys (union): ${[...accountKeys].sort().join(', ')}`)
  lines.push(`org keys (union): ${[...orgKeys].sort().join(', ')}`)
  lines.push(`transaction keys (union): ${[...transactionKeys].sort().join(', ')}`)
  lines.push(`transactions per account: [${transactionCounts.sort((a, b) => a - b).join(', ')}]`)

  const fieldTypeChecks: FieldTypeCheck[] = Object.entries(fieldChecks).map(([field, check]) => {
    const [topType, topCount] = [...check.types.entries()].sort((a, b) => b[1] - a[1])[0] ?? [
      'undefined',
      0,
    ]
    return {
      field,
      type: topType,
      matching: topCount,
      total: check.total,
      checkDot: field === 'balance' || field === 'amount',
      dotCount: check.dots,
    }
  })
  for (const check of fieldTypeChecks) {
    lines.push(`  ${check.field}: typeof ${check.type} (${check.matching}/${check.total})`)
    if (check.checkDot) {
      lines.push(`  ${check.field}: contains "." (${check.dotCount}/${check.total})`)
    }
  }

  lines.push(`distinct currencies: ${[...new Set(currencies)].sort().join(', ')}`)
  if (transactedCount > 0) {
    lines.push(
      formatUnixSecondsCount(transactedTimestampMin, transactedTimestampMax, transactedCount),
    )
  } else {
    lines.push('transaction span: 0 days across 0 transactions')
  }
  const errors = Array.isArray(body.errors) ? body.errors : []
  lines.push(`errors: ${errors.length}`)
  lines.push(`x-api-message: ${JSON.stringify(body['x-api-message'] ?? null)}`)

  // Step 7: money self-test, synthetic constants only — never run over live
  // response values.
  const TRUNCATION_CASES = ['19.99', '0.29', '8.41', '1.005', '-33.33'] as const

  function parseDecimalToCents(value: string): number {
    const match = /^-?\d+(\.\d{1,})?$/.exec(value)
    if (!match) throw new Error('not a plain decimal string')
    const fraction = match[1]
    if (fraction && fraction.length - 1 > 2) {
      throw new Error('sub-cent precision')
    }
    const [wholePart, fractionPart = ''] = value.split('.')
    const paddedFraction = fractionPart.padEnd(2, '0')
    const negative = wholePart.startsWith('-')
    const absoluteWhole = negative ? wholePart.slice(1) : wholePart
    const cents = Number(absoluteWhole) * 100 + Number(paddedFraction)
    return negative ? -cents : cents
  }

  lines.push('')
  lines.push(
    '| value | Math.trunc(parseFloat(v)*100) | Math.round(parseFloat(v)*100) | parseDecimalToCents(v) |',
  )
  lines.push('|---|---|---|---|')
  for (const value of TRUNCATION_CASES) {
    const truncated = Math.trunc(Number.parseFloat(value) * 100)
    const rounded = Math.round(Number.parseFloat(value) * 100)
    let parsed: string
    try {
      parsed = String(parseDecimalToCents(value))
    } catch {
      parsed = 'error (sub-cent)'
    }
    lines.push(`| ${value} | ${truncated} | ${rounded} | ${parsed} |`)
  }
  lines.push('')
  lines.push(
    '`Math.round(parseFloat(v)*100)` is exact for `|amount| < 90071992547409` — i.e. it is *not* wrong at any realistic magnitude. **Do not claim it is.** It *does* silently collapse sub-cent precision: `1.005 -> 100` ($1.00, not $1.01). A string-based parser is still the correct answer, but the honest justification is sub-cent precision and auditability, **not** "floats break at $19.99 with rounding."',
  )

  // Step 8: instant -> calendar-day self-test, synthetic constant only.
  const SYNTHETIC_INSTANT_MS = Date.UTC(2026, 0, 2, 3, 0, 0) // 2026-01-02T03:00:00Z, a literal, not the clock
  const utcDay = todayIn('UTC', SYNTHETIC_INSTANT_MS)
  const laDay = todayIn('America/Los_Angeles', SYNTHETIC_INSTANT_MS)
  lines.push('')
  lines.push(`posted 2026-01-02T03:00:00Z -> UTC: ${utcDay} | America/Los_Angeles: ${laDay}`)
  lines.push(
    "A one-day disagreement: an adapter must take a timezone parameter and can never use the server's local zone.",
  )
  if (utcDay === laDay) {
    throw new Error(
      'Timezone self-test did not disagree as expected: UTC and America/Los_Angeles produced the same calendar day.',
    )
  }

  // Step 9: verify, then flush.
  const transcript = lines.join('\n')
  assertNoSecrets(transcript, secrets)
  mkdirSync(join(import.meta.dirname, '../.claude/runway-runner/tasks/24'), { recursive: true })
  writeFileSync(TRANSCRIPT_PATH, transcript)
  console.log(transcript)
  process.exitCode = 0
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  try {
    assertNoSecrets(message, secrets)
  } catch {
    console.error('Redaction check failed on the error path. Nothing was printed.')
    process.exitCode = 1
    return
  }
  console.error(message)
  process.exitCode = 1
})
