# 0002 — Bank aggregator for automatic balances and transactions

**Status:** decided, held for review. Never self-merged — see
`docs/spikes/bank-aggregator-evaluation.md` for how this spike is shipped.
**Date:** 2026-09-14
**Driven by:** [issue #24](https://github.com/JaidenDeChon/runway/issues/24)
**Blocks:** [#25](https://github.com/JaidenDeChon/runway/issues/25) (Aggregator integration),
[#26](https://github.com/JaidenDeChon/runway/issues/26) (Actuals reconciliation)

---

## Context

Runway is a personal cash-flow app; every route is behind a Supabase
session; accounts, recurring rules and occurrences are real rows.
`domain/accounts.ts`'s `applyBalanceReadings` was built as the seam an
automatic balance source would call — its own doc comment already names
"a bank connection, an import, a scheduled job" as interchangeable callers
of the same function. Issue #24 asked which non-Plaid aggregator, if any,
supplies those readings, and said explicitly that "no aggregator is
economically viable and CSV/OFX import remains the automation story" is a
legitimate outcome. The full evidence is in
`docs/spikes/bank-aggregator-evaluation.md`; this document is the decision
drawn from it.

---

## Options considered

Numbers pulled from `scripts/aggregator-cost-model.ts`'s output (spike doc
§4), not from memory.

| Candidate | App-side cost at 1 user | App-side cost at 1,000 users | Sandbox demonstrated? | Credential custody | Headline blocker |
|---|---|---|---|---|---|
| SimpleFIN Bridge | $0.00 `[U]` (billed to end user) | $0.00 `[U]` | **Yes** — live, in this spike | None — app never sees bank credentials | Billing party and US coverage both `[U]` |
| Stripe Financial Connections | $7.20 | $7,200.00 | No — needs a Stripe business account | Stripe API key, server-side | Sole-proprietor eligibility `[U]` |
| Teller | $0.00 (under the 100-connection free tier) | $7,200.00 (conservative model) | No — sandbox likely needs a signed-up `applicationId` `[U]` | mTLS private key, server-side, production only | Redistribution prohibited; consent-UI condition precedent; terminable at will |
| Sales-gated tier (Yodlee, MX, Finicity, Akoya) | Five- to six-figure minimums `[S]` | Same | No | Vendor-specific, per contract | Sales-gated; never in contention on price |

---

## Decision

**SimpleFIN Bridge, as a bring-your-own-token integration, is the
aggregator Runway adopts — and it is adopted subject to a gate: issue #25
does not start until human-todo items 1, 2 and 3 below come back.**

**No per-connection paid aggregator is adopted at Runway's current scale.**
Stripe Financial Connections is the runner-up and the named fallback;
Teller is third; the sales-gated tier (Yodlee, MX, Finicity, Akoya) is
excluded outright.

Four reasons, obligation surface first, cost second — that ordering is what
survives the volume question:

1. **It is the only candidate a working connection was actually made to.**
   The issue's DoD requires "a working sandbox connection with the top
   candidate before deciding", and `scripts/simplefin-sandbox.ts` makes one
   on every run: no account, no credit card, no sales call, three HTTP
   requests, `200` at every step. Stripe FC needs a Stripe business
   account; Teller's sandbox very likely needs a signed-up `applicationId`
   (`[U]`).
2. **It carries the smallest obligation surface of any candidate.** The app
   holds no vendor API key, no mTLS private key, and never sees bank
   credentials; access is read-only by design; the user is the Bridge's
   account holder and hands the app a token they can revoke at the source.
   Revocation, which #25's DoD requires to "genuinely delete", reduces to
   deleting one stored access URL. Teller, by contrast, requires custody of
   an mTLS private key on the deploy target *and* a consent flow capturing
   acceptance of a third party's End User ToS as a condition precedent.
3. **App-side marginal cost is $0 at every modelled scale** — the $15/yr is
   billed to the end user (`[U]`, revert trigger #1) — against $0.30/
   enrollment/month for both paid alternatives, in a project with no
   revenue mechanism anywhere in the repo or the issue tracker.
4. **It fails safe when withdrawn.** Every candidate carries
   vendor-withdrawal risk and §1033 is enjoined, so none has a legal
   backstop. SimpleFIN's failure mode is one user's token going stale;
   Teller's documented failure mode is the developer account being
   terminated "at any time, with or without cause", taking every user's
   connection at once.

---

## The walk-away threshold — two axes

**Axis 1 — cost. Default: $0/year of recurring app-side aggregator spend.**
Runway has no billing, no subscription and no revenue mechanism; there is
nothing in the repo or on the board that charges a user. So the default
threshold is zero, and *any* aggregator with a nonzero recurring app-side
per-user cost is walked away from until either a revenue mechanism exists
or the owner sets a budget.

If the owner sets an annual budget **B**, the trigger on a
30¢/enrollment/month aggregator at the model's 2 institutions per user is
`floor(B / $7.20)` connected users:

| Annual budget B | Max connected users before B is exceeded |
|---|---|
| $0 (default) | 0 — any paid connection exceeds it |
| $120 | 16 |
| $600 | 83 |
| $1,200 | 166 |

(Regenerate with `bun scripts/aggregator-cost-model.ts`; $7.20 = 30¢ × 12
months × 2 institutions, and the institutions figure is a stated
assumption, not a measurement.)

**Axis 2 — compliance scope. Stop accepting new bank connections at 4,000
connected users** unless the full nine-element Safeguards Rule program is
in place by then. The FTC's threshold is **5,000** consumers, below which
certain provisions are relieved — the written risk assessment, continuous
monitoring / annual pen testing, the written incident response plan and
the annual board report — but the Rule itself still applies. **4,000 is a
policy buffer chosen here, not a legal figure**; 5,000 is the statutory
line.

**A second gate at 500 connected users:** above it, a single incident
becomes an FTC-notifiable event within 30 days (unauthorized acquisition
of 500 consumers' unencrypted information). An incident-response runbook
must exist before crossing 500, even though the sub-5,000 relief means it
need not be the Rule's formal written plan.

**The two axes bind independently. Whichever is hit first stops the
feature.**

---

## Consequences

- What #25 may now assume: the adapter is a *caller* of
  `applyBalanceReadings(accounts, readings, asOf)` producing
  `BalanceReading[]` + an `IsoDate`; it owns exactly two conversions
  (decimal string → integer cents via a string parser, unix instant →
  `IsoDate` via `todayIn` with a timezone parameter); the stored secret per
  user is a single access URL and must be treated as a credential
  (encrypted at rest, server-only, never logged, never in a URL); sync
  budget is 24 requests/day per access URL.
- What #25 must **not** assume: that SimpleFIN covers the user's banks
  (`[U]`); that the $15 is user-billed (`[U]`); that a connect screen's
  design exists — `docs/design/` has no bank-connection directory and #25
  needs one before any UI is built.
- #22 (CSV/OFX import) ships first by priority and shares the boundary:
  #25's DoD already requires aggregator data to flow through the same
  functions import uses. The adapter is a second caller of one path, never
  a parallel one.
- No new dependency, no schema change, no route, nothing shipped to users
  by this spike.
- The `scripts/simplefin-sandbox.ts` harness stays in the tree as the
  reproduction for anyone revisiting this.

### Reverting this decision

1. **The $15/yr turns out to be billed to the app.** Cost basis inverts:
   $15/user/yr beats $7.20/user/yr only until it does not. Re-run the cost
   model with `SIMPLEFIN_APP_SIDE_CENTS_PER_YEAR = 1500` and re-decide
   between SimpleFIN and Stripe FC.
2. **SimpleFIN coverage misses the owner's own banks.** At n=1 this is
   fatal; fall back to the runner-up, Stripe FC, and resolve its
   business-account eligibility question first.
3. **SimpleFIN's terms turn out to prohibit third-party consumer apps or
   the token flow.** Fall back to Stripe FC.
4. **Connected users approach 500 or 4,000.** Axis 2 fires; stop accepting
   new connections and reopen this decision with the compliance program as
   the subject.
5. **A revenue mechanism appears.** Axis 1's default of $0 was set by the
   absence of one; with one, Stripe FC at 30¢ becomes genuinely affordable
   and this decision should be re-argued on coverage rather than cost.

The evidence lives at this branch's commits, `docs/spikes/bank-aggregator-evaluation.md`,
and the two `scripts/` harnesses, all of which survive the decision.

---

## The strongest argument against this

**Stripe Financial Connections should have won, and choosing SimpleFIN
trades a real product for a real tax on the user.**

At Runway's actual scale the "expensive" option is not expensive. One user
with two institutions costs **$7.20 a year** — less than a sandwich, less
than the $15 SimpleFIN charges that same user. Even a hundred connected
users is **$720 a year**. The cost argument for SimpleFIN only becomes
decisive at volumes Runway has no users for and no plan to reach, and at
*those* volumes Axis 2's compliance cliff has already fired and cost is not
the binding constraint anyway. Meanwhile Stripe FC claims ~97% of US bank
accounts across ~12,000 institutions, with a documented testing
environment, webhooks, a 180-day history pull and daily updates — and
Stripe's own docs name "personal finance apps" as a blessed use case, so
this is not a grey-area integration. SimpleFIN's coverage is a number
nobody in this spike could produce.

And SimpleFIN's real cost is not $0, it is **friction**: before Runway can
show a user a single automatic balance, that user must find SimpleFIN
Bridge, create an account there, pay $15, connect their banks *in a second
product*, generate a setup token, and paste it into Runway. That is a
funnel most people will not finish, and the $0 app-side figure is $0
precisely because the cost was pushed onto the person the app is for. A
24-requests-per-day ceiling on top of it constrains the sync design
forever.

**Why the decision still stands:** what distinguishes the two is not
price, it is *what Runway becomes*. Stripe FC requires the owner to open a
Stripe **business** account eligible for Financial Connections — an
eligibility this spike explicitly could not confirm for a sole proprietor
and refuses to assert — and it makes Runway the custodian of
aggregator-issued access tokens for other people's bank accounts, with the
FTC Safeguards Rule's nine-element program attached and, with §1033
enjoined, no right-of-access backstop if the arrangement is withdrawn.
SimpleFIN leaves the user as the account holder and Runway as a read-only
consumer of a token the user controls and can revoke at the source. For a
single-maintainer, no-revenue, MIT-licensed personal project, the
obligation asymmetry is larger than the price asymmetry at every scenario
in the cost model — and the price asymmetry is the only one that reverses
as scale grows. The moment either premise changes, revert triggers 1, 2, 3
and 5 above are the door out, and Stripe FC is the named destination.

---

## What still needs a human

1. **Confirm who is billed SimpleFIN's $15/yr.** Create a Bridge account
   at `https://beta-bridge.simplefin.org/` and observe the checkout, or
   ask SimpleFIN directly. **Revert trigger #1**; the cost model turns on
   it.
2. **Confirm SimpleFIN's terms** permit a third-party consumer app to
   consume a user-supplied token, and what they say about redistribution —
   both were `UNVERIFIED` after this spike's fetches.
3. **Set the annual aggregator budget B.** Default $0. This sets Axis 1's
   trigger and is the gate on #25 starting.
4. **Decide whether Runway accepts GLBA "financial institution" scope at
   all**, and if yes, designate the "qualified individual" (element 1).
   For a solo project that is the owner — but it has to be a conscious
   designation, not an accident.
5. **Have counsel confirm the GLBA scoping** and whether a published
   privacy policy must ship before any bank connection does. This spike is
   desk research; it is not legal advice and says so.
6. **Only if this decision is revisited toward Stripe FC:** confirm the
   owner can open a Stripe business account eligible for Financial
   Connections as a sole proprietor. **This spike does not assert that he
   qualifies.**
7. **Check SimpleFIN's coverage against the banks the owner actually
   uses.** At n=1, this is the only coverage test that matters.
8. **Commission a `docs/design/` directory for the bank-connection flow**
   before #25 builds any UI. None exists today.
9. **Review and merge this PR by hand.** Spikes in this repo are held for
   review and never self-merged.
