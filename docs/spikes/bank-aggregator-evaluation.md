# Bank aggregator evaluation

Issue [#24](https://github.com/JaidenDeChon/runway/issues/24). Branch
`spike/bank-aggregator-evaluation`. Disposition: **hold for review** — this
spike is never self-merged; the deliverable is the decision recorded in
[`../decisions/0002-bank-aggregator.md`](../decisions/0002-bank-aggregator.md).

This document is the evidence. The decision, the walk-away threshold, and the
strongest argument against it live in the ADR — read that first if you only
have five minutes.

---

## 1. What this answers, and how

The question: which non-Plaid bank aggregator, if any, supplies the
`BalanceReading[]` + `IsoDate` that `domain/accounts.ts`'s
`applyBalanceReadings` was built to accept, and at what price, under what
obligations, and at what point does Runway stop.

**The sourcing rule, absolute throughout this document and its companion
ADR:** no number appears that is not in the underlying research dossiers or
that was not fetched from a URL cited in the same paragraph. Every factual
cell in every table carries an evidence marker:

- **`[V]`** — verified, primary source, cited.
- **`[S]`** — secondary source, estimate only.
- **`[U]`** — unverified / not fetched.

A cell with no marker is a bug. Research for this spike, including every live
fetch and the sandbox connection below, was carried out on **2026-09-14**;
prices and terms move, and a reader relying on this document later should
re-verify anything load-bearing.

---

## 2. The field, and who is in it

**In:** SimpleFIN Bridge, Stripe Financial Connections, Teller, and the
sales-gated tier (Yodlee/Envestnet, MX, Finicity/Mastercard, Akoya).

**Out:**
- **Plaid** — excluded by the issue's own wording ("non-Plaid").
- **GoCardless Bank Account Data (ex-Nordigen)** — a free tier exists but is
  **EU/UK only, no US coverage** `[U]`. This is well established in the
  aggregator space but was not independently re-verified in this spike, so it
  keeps the `[U]` marker rather than being asserted as `[V]`. It fails the US
  requirement outright either way.

**This is not a flat five-way scorecard**, the same way the chart bake-off
kept its own comparison asymmetric rather than flattening it:

- **SimpleFIN is the only candidate a working connection was actually made
  to.** §5 below is that connection, live, on every run of this spike's
  harness.
- **The sales-gated tier was never in contention on price.** Every dollar
  figure available for it is secondary-source and describes five- and
  six-figure minimums; it is covered for completeness, not as a serious
  contender at Runway's scale.
- **Stripe Financial Connections and Teller are the two real paid
  alternatives** — both have fully public, per-unit pricing and both were
  evaluated in depth.

---

## 3. The comparison matrix

Legend: `[V]` verified/primary-source · `[S]` secondary-source estimate ·
`[U]` unverified/not fetched.

| # | Criterion | SimpleFIN Bridge | Stripe Financial Connections | Teller | Sales-gated tier (Yodlee/MX/Finicity/Akoya) |
|---|---|---|---|---|---|
| 1 | Transaction pricing (unit) | Not per-transaction — flat subscription, see row 3 `[V]` | 30¢/institution/account holder/month `[V]` (source: https://stripe.com/financial-connections) | $0.30/enrollment/month `[V]` (source: https://teller.io/) | Sales-gated; no published unit price `[S]` |
| 2 | Other unit prices (verification/balance/identity) | n/a — flat subscription | Verification $1.50/account, balance 10¢/call `[V]` | Verify $1.50/account, balance 10¢/call, identity $1.75/call `[V]` | Not disclosed `[U]` |
| 3 | Billing party (app vs end user) | **End user's SimpleFIN account is billed**, not the app `[U]` — the developer page does not state this explicitly; inferred from Bridge being a consumer-facing product the user signs up for. **Flagged, load-bearing.** | App (Stripe customer) `[V]` | App (Teller customer) `[V]` | App, contractually `[S]` |
| 4 | App-side annual cost at 1/100/1,000/10,000 users (2 institutions/user) | $0.00 at every scale `[U]` (see row 3) | $7.20 / $720.00 / $7,200.00 / $72,000.00 `[V]` — see §4 | $0.00 / $720.00 / $7,200.00 / $72,000.00 (conservative-cliff model) `[V]`/`[U]` on cliff behaviour — see §4 | Five- to six-figure annual minimums reported `[S]` |
| 5 | US institution coverage | Coverage page exists (`/search-institutions`), **no count or enumerable list found** `[U]` — see §5's fetch below | ~97% of US bank accounts, ~12,000 institutions `[V]` | Not independently enumerated in this spike; not the coverage bottleneck given Stripe's figure `[U]` | Yodlee 17,000+ data sources, MX ~16,000 institutions, Finicity ~15,000 institutions, Akoya narrower (bank-owned, API-only) — all `[S]` |
| 6 | Sandbox: signup required? credit card? demonstrated in this spike? | **No signup, no credit card, demonstrated live in §5** `[V]` | Testing environment exists but requires a Stripe account; **not attempted in this spike** (needs a business account, see human-todo) `[V]` on existence, not attempted | Sandbox is free, no real banks, fixed test users; **not attempted in this spike** (likely needs a signed-up `applicationId`, `[U]`) | Sales call required; not attempted, not applicable |
| 7 | Data freshness (cadence, history, webhooks, rate limits) | 24 requests/day per access URL; single endpoint returns all accounts+transactions `[V]` | 180-day pull, daily updates, webhooks `[V]` | Not independently verified in this spike beyond pricing/terms `[U]` | Not disclosed `[U]` |
| 8 | Consumer apps permitted by terms? | Not found on `www.simplefin.org` or `beta-bridge.simplefin.org` — silent on this `[U]` | **Named, blessed use case**: "Data products... such as personal finance apps" `[V]` (source: https://docs.stripe.com/financial-connections) | Permitted, but every end user must expressly accept Teller's End User ToS and Privacy Policy as a condition precedent — real consent UI required `[V]` | Not disclosed `[U]` |
| 9 | Redistribution permitted by terms? | Not found — silent `[U]` | Not found on the docs page fetched for this spike — silent on redistribution specifically `[U]` | **Prohibited.** Developers may not "sublicense, resell, rent, lease, transfer, assign, time share or otherwise commercially exploit or make the Services available to any third party." `[V]` | Not disclosed `[U]` |
| 10 | Credential custody | App never sees bank credentials or holds a vendor API key; user is the Bridge account holder and hands the app a revocable token `[V]` | Stripe-issued API key held server-side `[V]` | **mTLS client certificate** (private key) issued by Teller, required in production, not sandbox `[V]` | Vendor API key or equivalent, per contract `[S]` |
| 11 | Compliance obligations created | Same GLBA exposure as any bank-data ingestion (§7); no vendor ToS consent UI `[U]`/`[V]` mixed — see §7 | Same GLBA exposure; requires a Stripe business account `[V]` | Same GLBA exposure, plus a documented, contractual consent-UI obligation `[V]` | Likely contractual SOC 2 / security-review expectations at this tier `[S]` |
| 12 | Vendor-withdrawal risk | Failure mode is one user's token going stale; §1033 enjoined, no federal backstop `[V]`/`[U]` mixed — see §7 | Standard Stripe ToS; §1033 enjoined, no federal backstop `[U]` on Stripe's own termination terms (not fetched) | **Termination at any time, with or without cause, immediately upon notice** `[V]`; §1033 enjoined, no federal backstop | Contractual, presumably negotiated `[S]` |

**On the sales-gated tier's dollar figures.** Every dollar figure in this
tier's row is secondary-source (getmonetizely, fintechspecs — not
vendor-published) and is marked `[S]` accordingly: Yodlee monthly
subscription $5K–$50K+, setup $10K–$50K, annual totals $100K–$200K; MX and
Finicity pricing not publicly disclosed; Akoya pricing not found. **The exact
numbers are not well supported. The conclusion they support — that this tier
is sales-gated with five-figure minimums — is well supported**, and that
conclusion, not the digits, is what this spike relies on.

---

## 4. Cost model

Generated by `scripts/aggregator-cost-model.ts`. Reproduce with:

```sh
bun scripts/aggregator-cost-model.ts
```

**Assumptions**, stated as assumptions:
- `ASSUMPTION`: 2 institutions per connected user (one bank + one card/second
  bank) is the base case; 1 and 4 are shown as a sensitivity band.
- `ASSUMPTION`: the four volume scenarios (1, 100, 1,000, 10,000 connected
  users) are the ones the issue's DoD names, not a forecast of Runway's
  actual growth.
- `ASSUMPTION`: the four annual budget scenarios in table 3 ($0, $120, $600,
  $1,200) are a menu for the human to pick from, not a recommendation of
  which to pick.
- Teller's free-tier cliff-vs-allowance behaviour at connection 101 is
  `[U]` (dossier A), so it is modelled **twice** — see table 1.

Script stdout, verbatim:

```
## Other unit prices (not part of the annual cost model above)

| Provider | Verification | Balance | Identity |
|---|---|---|---|
| stripe-fc | $1.50/account | $0.10/call | — |
| teller | $1.50/account | $0.10/call | $1.75/call |

## Table 1 — app-side annual cost by provider × connected users
(institutions per user = 2, an ASSUMPTION)

| Provider | 1 users | 100 users | 1,000 users | 10,000 users |
|---|---|---|---|---|
| simplefin (app-side) | $0.00 | $0.00 | $0.00 | $0.00 |
| stripe-fc | $7.20 | $720.00 | $7,200.00 | $72,000.00 |
| teller (conservative) | $0.00 | $720.00 | $7,200.00 | $72,000.00 |
| teller (optimistic) | $0.00 | $360.00 | $6,840.00 | $71,640.00 |

## Table 2 — sensitivity to institutions per user

| Provider | Institutions/user | 1 users | 100 users | 1,000 users | 10,000 users |
|---|---|---|---|---|---|
| stripe-fc | 1 | $3.60 | $360.00 | $3,600.00 | $36,000.00 |
| stripe-fc | 2 | $7.20 | $720.00 | $7,200.00 | $72,000.00 |
| stripe-fc | 4 | $14.40 | $1,440.00 | $14,400.00 | $144,000.00 |
| teller (conservative) | 1 | $0.00 | $0.00 | $3,600.00 | $36,000.00 |
| teller (conservative) | 2 | $0.00 | $720.00 | $7,200.00 | $72,000.00 |
| teller (conservative) | 4 | $0.00 | $1,440.00 | $14,400.00 | $144,000.00 |

## Table 3 — cost-axis walk-away trigger
(30¢/enrollment/month aggregator at 2 institutions/user, an ASSUMPTION)

| Annual budget B | Max connected users before B is exceeded |
|---|---|
| $0.00 | 0 users — any connection exceeds the budget |
| $120.00 | 16 |
| $600.00 | 83 |
| $1,200.00 | 166 |

Compliance-scope axis (no dollar figure):
- 5,000-consumer line: below it, the FTC Safeguards Rule relieves the written risk
  assessment, continuous monitoring / annual pen testing, written incident response
  plan and annual board report — the Rule itself still applies.
  source: https://www.ftc.gov/business-guidance/resources/ftc-safeguards-rule-what-your-business-needs-know
- 500-consumer breach-notification trigger: unauthorized acquisition of 500
  consumers' unencrypted information must be reported to the FTC within 30 days.
  source: https://www.ftc.gov/business-guidance/resources/ftc-safeguards-rule-what-your-business-needs-know
- 4,000-connected-user policy gate: a policy buffer chosen in
  docs/decisions/0002-bank-aggregator.md, not a legal figure — stop accepting new
  bank connections at 4,000 unless the full nine-element Safeguards Rule program is
  in place.

Not monetized on purpose — see docs/spikes/bank-aggregator-evaluation.md §7. This
spike does not price counsel time, and inventing a figure would be the exact
failure it exists to prevent.

SimpleFIN end-user cost (separately labelled, never confused with an app-side cost): $15.00/user/yr, billed to the end user — UNVERIFIED billing party
```

**The walk-away threshold** (full wording in the ADR, canonical there):
**Axis 1 (cost)** defaults to $0/year of recurring app-side aggregator spend
— Runway has no billing or revenue mechanism, so any nonzero recurring
app-side cost is walked away from by default; if the owner sets a budget B,
the trigger is `floor(B / $7.20)` connected users at 2 institutions/user.
**Axis 2 (compliance scope)** stops new bank connections at 4,000 connected
users (a policy buffer) unless the full Safeguards Rule program is in place
by then, with a second gate at 500 (the breach-notification trigger). The two
axes bind independently — whichever fires first stops the feature.

---

## 5. The live sandbox connection

This is the heart of the evidence: a real, signup-free, no-credit-card
connection to SimpleFIN Bridge's public demo, made by `scripts/simplefin-sandbox.ts`
on every run.

### The flow, with real HTTP codes

1. `GET https://beta-bridge.simplefin.org/info/developers` → **200**.
2. Base64-decode the scraped setup token → a claim URL.
3. `POST` the claim URL → **200**; body is a credentialed access URL.
4. `GET <access URL>/accounts` → **200**.

A second `POST` to the same claim URL returns **403 `Forbidden (was it
already claimed?)`** — observed directly during this spike's research, and
the harness treats it as an expected, non-fatal outcome rather than a bug,
because the docs page mints a fresh token on every load ("Refresh this page
for another demo token"). This makes the connection repeatable and means no
run consumes a shared resource.

### The transcript, verbatim

```
[1/3] GET https://beta-bridge.simplefin.org/info/developers -> 200 (10067 bytes)
[1/3] setup token found: 104 chars, decodes to https://beta-bridge.simplefin.org/simplefin/claim/<redacted>
[2/3] POST claim URL -> 200; access URL received: https://<redacted>@beta-bridge.simplefin.org/simplefin
[3/3] GET beta-bridge.simplefin.org/simplefin/accounts -> 200 (3294 bytes)
top-level keys: accounts, errors, x-api-message
accounts: 3
account keys (union): available-balance, balance, balance-date, currency, holdings, id, name, org, transactions
org keys (union): domain, id, name, sfin-url, url
transaction keys (union): amount, description, id, mcc, memo, payee, posted, transacted_at
transactions per account: [0, 5, 5]
  balance: typeof string (3/3)
  balance: contains "." (3/3)
  available-balance: typeof string (3/3)
  balance-date: typeof number (3/3)
  amount: typeof string (10/10)
  amount: contains "." (10/10)
  posted: typeof number (10/10)
  transacted_at: typeof number (10/10)
distinct currencies: USD
transaction span: 2 days across 10 transactions
errors: 0
x-api-message: ["Provide a 'start-date' parameter to receive transactions prior to yesterday"]

| value | Math.trunc(parseFloat(v)*100) | Math.round(parseFloat(v)*100) | parseDecimalToCents(v) |
|---|---|---|---|
| 19.99 | 1998 | 1999 | 1999 |
| 0.29 | 28 | 29 | 29 |
| 8.41 | 841 | 841 | 841 |
| 1.005 | 100 | 100 | error (sub-cent) |
| -33.33 | -3333 | -3333 | -3333 |

`Math.round(parseFloat(v)*100)` is exact for `|amount| < 90071992547409` — i.e. it is *not* wrong at any realistic magnitude. **Do not claim it is.** It *does* silently collapse sub-cent precision: `1.005 -> 100` ($1.00, not $1.01). A string-based parser is still the correct answer, but the honest justification is sub-cent precision and auditability, **not** "floats break at $19.99 with rounding."

posted 2026-01-02T03:00:00Z -> UTC: 2026-01-02 | America/Los_Angeles: 2026-01-01
A one-day disagreement: an adapter must take a timezone parameter and can never use the server's local zone.
```

### The observed schema

Top-level: `accounts`, `errors`, `x-api-message`.

Account: `id`, `name`, `currency`, `balance`, `available-balance`,
`balance-date`, `holdings`, `transactions`, `org`.

Org: `id`, `name`, `domain`, `url`, `sfin-url`.

Transaction: `id`, `posted`, `amount`, `description`, `payee`, `memo`,
`transacted_at`, `mcc`.

Issue #26's actuals-reconciliation matching work will key off `amount`,
`posted`/`transacted_at`, `description` and `payee` — those are the fields
that identify and date a transaction; the rest (`mcc`, `memo`) are
enrichment.

### The two collisions, and where they land

An adapter's entire job reduces to producing `BalanceReading[]` plus an
`asOf: IsoDate` and handing them to `domain/accounts.ts`'s
`applyBalanceReadings`, whose own doc comment already designates this:

> **This is the seam for automatic balance refresh.** Whatever eventually
> supplies readings — a bank connection, an import, a scheduled job — hands
> the same `{ accountId, balance }[]` and the same `asOf` to this function...
> an automatic source should be a different *caller*, not a different code
> path.

That locates exactly two conversions the adapter owns, neither implemented
here:

1. **Decimal string → integer cents.** SimpleFIN's `balance` and `amount`
   are JSON strings like `"-33.33"` — CLAUDE.md requires integer minor
   units, "not one floating-point monetary value." The truncation table
   above is the live proof, reproduced from this run rather than re-typed.
   Quoting the module comment verbatim, because restating it risks
   overclaiming:

   > `Math.round(parseFloat(v)*100)` is exact for `|amount| < 90071992547409`
   > — i.e. it is *not* wrong at any realistic magnitude. **Do not claim it
   > is.** It *does* silently collapse sub-cent precision: `1.005 -> 100`
   > ($1.00, not $1.01). A string-based parser is still the correct answer,
   > but the honest justification is sub-cent precision and auditability,
   > **not** "floats break at $19.99 with rounding."

   `domain/money.ts:12`'s `toMinorUnits` is already `Math.round(major * 100)`
   — the correct rounding form. The repo has no truncation bug today; the
   risk is a future adapter reaching for `parseInt` or `| 0` on a SimpleFIN
   string instead of a proper decimal parser.

2. **Unix instant → calendar day.** `posted` and `transacted_at` are JSON
   **numbers** (unix seconds), and CLAUDE.md requires "calendar days, never
   instants." Converting requires a timezone: `domain/dates.ts:170`
   `todayIn(timeZone: string, at: number): IsoDate` is the right primitive
   despite its name (it converts any instant, not just "now"), and
   `app/composables/useTimeZone.ts` is where an adapter's timezone
   parameter would come from — it already resolves
   `timeZoneOverride ?? device ?? FALLBACK_TIME_ZONE`. The transcript's
   one-day-disagreement line above is a live proof of this, not prose: the
   harness throws if UTC and `America/Los_Angeles` ever agree on the same
   synthetic instant.

A rename or a `calendarDayIn` alias for `todayIn` is a plausible follow-up
for #25; this spike does not do it.

### Rate-limit implications for #25's sync design

24 requests/day per access URL, against a single endpoint that returns every
account and transaction in one call, means a refresh no more often than
roughly every hour is possible in principle, and a 2–4-hourly schedule
leaves real headroom. This spike does not design the scheduler — that is
#25's job — it only records the constraint the scheduler must respect.

---

## 6. Terms

**Only Teller's developer terms were actually fetched by the underlying
research** (`https://teller.io/legal/developer/terms`); nothing below should
be read as implying parity between the three aggregators' terms.

**Teller** (`[V]`, https://teller.io/legal/developer/terms — index at
`/legal`; `/legal/terms` 404s, the real paths are `/legal/developer/terms`,
`/legal/user/terms`, `/legal/developer/privacy`, `/legal/user/privacy`):

- Consumer apps permitted, but every end user must "review and expressly
  accept Teller's End User Terms of Service and End User Privacy Policy as a
  **condition precedent**" — real UI and consent plumbing, not just a legal
  formality.
- **Redistribution prohibited**: developers may not "sublicense, resell,
  rent, lease, transfer, assign, time share or otherwise commercially
  exploit or make the Services available to any third party."
- Security is "sole responsibility" of the developer; Services are "AS IS,"
  no warranty of being "secure, error-free or virus-free."
- **Termination at will**: Teller "may terminate your account and these
  Developer Terms at any time, with or without cause, immediately upon
  notice."

**SimpleFIN** — `https://www.simplefin.org/` and
`https://beta-bridge.simplefin.org/` were both fetched for this spike
(2026-09-14). Neither page addresses whether a third-party consumer app may
consume a user-supplied token, nor redistribution, nor the billing party for
the $15/yr fee. `UNVERIFIED — https://www.simplefin.org/, fetched
2026-09-14, does not address this` and `UNVERIFIED —
https://beta-bridge.simplefin.org/, fetched 2026-09-14, does not address
this`.

**Stripe Financial Connections** —
`https://docs.stripe.com/financial-connections` was fetched for this spike
(2026-09-14). It names "personal finance apps" as a blessed use case under
"Data products" `[V]` — this clears part A's original flag on standalone
consumer-app use, with this citation. It is **silent on redistribution
specifically**: no clause on sharing, reselling or redistributing collected
data appears on this page. `UNVERIFIED —
https://docs.stripe.com/financial-connections, fetched 2026-09-14, does not
address redistribution`. Stripe's own Services Agreement, which likely
governs redistribution contractually, was not fetched in this spike.

---

## 7. Compliance

**This is desk research to size the obligation, not legal advice.**
Confirmation by counsel is human-todo item 5 in the ADR.

### CFPB §1033 is enjoined, not in force, and is being rewritten

Finalized October 2024; phased compliance was to begin April 1, 2026 for the
largest data providers. A federal court in Kentucky enjoined enforcement,
finding it likely exceeded statutory authority and was arbitrary and
capricious. The CFPB told the court it now considers the rule unlawful,
withdrew its vacatur request, and instead reopened rulemaking (ANPR
published August 22, 2025). Mark the court/ANPR detail `[S]`
(consumerfinancemonitor.com, cozen.com, hklaw.com).

**Net effect: there is no federal right-of-access backstop.** Access to bank
data is contractual, at the aggregator's and the bank's discretion, and can
be withdrawn.

### GLBA / FTC Safeguards Rule

The FTC is the primary GLBA regulator for non-bank financial institutions.
"Financial institution" is construed broadly. Secondary commentary is
explicit that consumer fintech application providers accessing consumer
financial account and transaction data are considered financial institutions
subject to GLBA `[S]` (Orrick, Cooley, Spencer Fane, Paul Hastings). The
FTC's own page is `[V]`:
https://www.ftc.gov/business-guidance/resources/ftc-safeguards-rule-what-your-business-needs-know

The nine required program elements:

1. Designate a qualified individual to implement and supervise the program
2. Conduct a risk assessment
3. Design and implement safeguards to control identified risks
4. Regularly monitor and test the effectiveness of safeguards
5. Train staff on security awareness
6. Monitor service providers
7. Keep the program current and flexible
8. Create a written incident response plan
9. Require the qualified individual to report to the Board of Directors

**Thresholds**: institutions maintaining customer information on **fewer
than 5,000 consumers** are exempt from certain provisions — the written risk
assessment, continuous monitoring / annual pen testing, the written incident
response plan, and the annual board report — **but not from the Rule
itself**. Breach notification to the FTC is required within **30 days** of
discovering unauthorized acquisition of **500 consumers'** unencrypted
information.

### The honest scoping note

The Rule's applicability turns on *maintaining customer information*, and
issue #22's CSV/OFX import path maintains the same class of information. The
aggregator decision therefore does not cleanly avoid the obligation — it
changes its *volume* and adds element 6 (monitor service providers) with a
named third party attached. This is a desk-research observation, not a legal
conclusion.

### Not monetized

This spike does not price counsel time or a SOC 2 audit. Inventing such a
figure is precisely the failure mode this spike exists to prevent — see the
one rule at the top of the plan that governs it. Counsel review is human-todo
item 5 in the ADR.

---

## 8. The UNVERIFIED register

| Item | Why it matters | What would resolve it | Who |
|---|---|---|---|
| SimpleFIN's billing party for the $15/yr | The entire cost model's headline conclusion (app-side cost is $0) turns on this | Create a Bridge account and observe the checkout, or ask SimpleFIN directly | Human — ADR item 1 |
| SimpleFIN US institution coverage | Determines whether the winning candidate even covers the owner's banks | Enumerate `/search-institutions` results against the owner's actual banks | Human — ADR item 7 |
| SimpleFIN terms on consumer apps / redistribution | Determines whether the bring-your-own-token flow is actually permitted | Fetch a terms/legal page if one surfaces, or ask SimpleFIN directly | Human — ADR item 2 |
| Stripe FC terms on redistribution | Determines whether aggregated Stripe data could ever be shared beyond Runway | Fetch Stripe's Services Agreement or ask Stripe | Human — deferred, not currently load-bearing (SimpleFIN is the pick) |
| Stripe business-account eligibility for a sole proprietor | Determines whether the runner-up is even reachable if SimpleFIN falls through | Attempt to open a Stripe account eligible for Financial Connections | Human — ADR item 6 |
| Teller behaviour at connection 101 (cliff vs. allowance) | Changes the cost-model shape for the third-place candidate | Ask Teller, or exceed the free tier and observe | Deferred — Teller is third either way |
| Whether Teller's sandbox needs a signed-up `applicationId` | Determines whether Teller's sandbox is actually as signup-free as SimpleFIN's | Attempt the sandbox flow without signing up | Deferred — not attempted in this spike |
| GoCardless US unavailability | Confirms the exclusion in §2 is correct | Re-verify against GoCardless's own coverage page | Low priority — well-established, not load-bearing |
| Every `[S]` figure in the sales-gated tier (Yodlee/MX/Finicity/Akoya pricing) | These numbers are cited from secondary sources, not vendor-published | A direct sales inquiry to each vendor | Not planned — this tier was never in contention on price |

---

## 9. Sources

Primary (fetched directly, cited by URL above):

1. https://stripe.com/financial-connections
2. https://docs.stripe.com/financial-connections
3. https://teller.io/
4. https://teller.io/docs/api/authentication
5. https://teller.io/docs/guides/sandbox
6. https://teller.io/legal
7. https://teller.io/legal/developer/terms
8. https://beta-bridge.simplefin.org/
9. https://beta-bridge.simplefin.org/info/developers
10. https://beta-bridge.simplefin.org/search-institutions
11. https://www.simplefin.org/
12. https://www.ftc.gov/business-guidance/resources/ftc-safeguards-rule-what-your-business-needs-know

Secondary (estimates and commentary only, never a matrix `[V]` cell):

- fintechspecs.com, getmonetizely.com, openbankingtracker.com (sales-gated
  tier pricing)
- consumerfinancemonitor.com, cozen.com, hklaw.com (§1033 court/ANPR
  commentary)
- paulhastings.com, orrick.com, cdp.cooley.com, spencerfane.com (GLBA
  applicability commentary)

---

## 10. Re-running this yourself

```sh
bun scripts/simplefin-sandbox.ts       # live sandbox connection, ~3 requests, no signup
bun scripts/aggregator-cost-model.ts   # regenerates §4's tables
```

`SIMPLEFIN_ACCESS_URL`, an optional environment variable read only by
`scripts/simplefin-sandbox.ts`, lets someone with a real SimpleFIN Bridge
account skip the demo-token exchange. It is a developer-only variable, not
one the running app reads, so it is deliberately absent from
`.env.example`. Neither script prints a balance or a credential — the
transcript is checked in code (`assertNoSecrets`) before anything is printed
or written to disk.

---

## 11. What this spike did not test

- **No Stripe FC or Teller sandbox connection was made.** Stripe requires a
  business account this spike could not open on the owner's behalf; Teller's
  sandbox very likely needs a signed-up `applicationId` (`[U]`). Only
  SimpleFIN — the DoD's "top candidate" — was connected to live.
- **No coverage was tested against the owner's actual banks.** SimpleFIN's
  and Teller's coverage are both `[U]` for this reason; Stripe's ~97%/12,000
  figure is vendor-published but was not checked against the owner's
  specific institutions either.
- **No aggregator was driven over time.** Reliability, reconnection
  behaviour, and what actually happens at Teller's connection 101 are all
  unmeasured.
- **No adapter was written**, in `domain/`, `app/`, `server/` or anywhere
  else. The two schema conversions are demonstrated inside
  `scripts/simplefin-sandbox.ts` only, and documented as belonging beside
  `applyBalanceReadings` when #25 builds them.
- **No database table, no RLS policy, no UI.** `docs/design/` has no
  bank-connection directory, so no screen or component was invented for this
  spike.
- **This spike touches no database and adds no route.** `bun run
  test:integration`, `bun run test:rls` and `bun run test:e2e` were not run
  and are not relevant to it.
