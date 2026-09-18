# 0002 — Bank aggregator for automatic balances and transactions

**Status:** **decided — no aggregator adopted.** Settled by the owner on
2026-09-17, superseding this document's earlier "adopt SimpleFIN, gated"
outcome. The evidence behind it is
`docs/spikes/bank-aggregator-evaluation.md`, retained as history.
**Date:** 2026-09-14, decision revised 2026-09-17
**Driven by:** [issue #24](https://github.com/JaidenDeChon/runway/issues/24)
**Bears on:** [#25](https://github.com/JaidenDeChon/runway/issues/25) (Aggregator integration),
[#26](https://github.com/JaidenDeChon/runway/issues/26) (Actuals reconciliation),
[#22](https://github.com/JaidenDeChon/runway/issues/22) (CSV and OFX import)

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
legitimate outcome — "not a failure."

That is the outcome. The full evidence is in
`docs/spikes/bank-aggregator-evaluation.md`; this document is the decision
drawn from it.

---

## Options considered

Numbers pulled from `scripts/aggregator-cost-model.ts`'s output (spike doc
§4), not from memory. Evidence markers are the spike doc's: `[V]` verified
primary source, `[S]` secondary estimate, `[U]` unverified.

| Candidate | App-side cost at 1 user | App-side cost at 1,000 users | Cost to the end user | Headline blocker |
|---|---|---|---|---|
| SimpleFIN Bridge | $0.00 `[U]` (billed to end user) | $0.00 `[U]` | **$15.00/yr** `[U]` | Charges a non-paying user real money |
| Stripe Financial Connections | $7.20 | $7,200.00 | $0 | Recurring app-side cost with no revenue to cover it |
| Teller | $0.00 (under the 100-connection free tier) | $7,200.00 (conservative model) | $0 | Same, past the free tier; plus mTLS key custody and a consent-UI condition precedent |
| Sales-gated tier (Yodlee, MX, Finicity, Akoya) | Five- to six-figure minimums `[S]` | Same | $0 | Never in contention on price |

**Every row costs somebody real money on a recurring basis.** That is the
finding the decision turns on, and it is why the fourth option below wins.

---

## Decision

**No bank aggregator is adopted at this time — not SimpleFIN, not Stripe
Financial Connections, not Teller, and not the sales-gated tier.**

**CSV/OFX import ([#22](https://github.com/JaidenDeChon/runway/issues/22))
remains the automation story**, exactly as issue #24 anticipated when it
named this a legitimate outcome rather than a failure.

The reasoning is short, and it does not depend on any of the unknowns this
spike left open:

1. **Every viable candidate imposes a real recurring cost on someone.**
   Stripe FC and Teller bill Runway per connection per month. SimpleFIN
   does not bill Runway — it bills **the user**, $15/yr, to a service they
   would have to sign up for separately.
2. **Runway has no revenue mechanism.** There is no billing, no
   subscription, and nothing anywhere in the repo or on the board that
   charges anyone. A recurring per-connection bill has nothing to come out
   of.
3. **Pushing that cost onto the user is worse, not better.** SimpleFIN's
   $0 app-side figure was only ever $0 because the cost moved to the person
   the app is for — someone who is not paying for anything else in Runway.
   Charging an unsold user $15/yr for a feature of a free app is not a
   trade the owner is willing to make right now. The apparent cheapness of
   the SimpleFIN option was an accounting artifact, not a saving.

This is a direct decision by the owner, not a re-run of the spike's
evidence. **The open unknowns are moot and are not reopened**: who is
billed SimpleFIN's $15/yr, what SimpleFIN's institution coverage is, and
whether the owner could open an eligible Stripe business account no longer
need answering, because no candidate is being adopted regardless of how
they resolve.

### What this decision is not

It is **not** a finding that the aggregators are bad, unsafe, or
technically unsuitable. SimpleFIN's sandbox worked on the first attempt and
every attempt after. Stripe FC is a well-documented product that names
personal finance apps as a blessed use case. The blocker is economic and it
sits on Runway's side of the line: **no revenue, therefore no recurring
cost, therefore no aggregator** — for Runway or for its users.

---

## The threshold that closed the door

The spike set a walk-away threshold on two axes. **Axis 1 fired**, at its
default, and that is what this decision records.

**Axis 1 — cost. Default: $0/year of recurring aggregator spend**, borne by
Runway *or* by a user who is not otherwise paying. Runway has no billing,
no subscription and no revenue mechanism, so the default threshold is zero
and every candidate exceeds it.

If a revenue mechanism ever exists and the owner sets an annual budget
**B**, the trigger on a 30¢/enrollment/month aggregator at the model's 2
institutions per user is `floor(B / $7.20)` connected users:

| Annual budget B | Max connected users before B is exceeded |
|---|---|
| $0 (today's default) | 0 — any paid connection exceeds it |
| $120 | 16 |
| $600 | 83 |
| $1,200 | 166 |

(Regenerate with `bun scripts/aggregator-cost-model.ts`; $7.20 = 30¢ × 12
months × 2 institutions, and the institutions figure is a stated
assumption, not a measurement.)

**Axis 2 — compliance scope — never had to fire, and is recorded here
because it constrains any future revisit.** The FTC Safeguards Rule's
threshold is **5,000** consumers, below which certain provisions are
relieved — the written risk assessment, continuous monitoring / annual pen
testing, the written incident response plan and the annual board report —
but the Rule itself still applies. A second gate sits at **500** connected
users, above which a single incident becomes an FTC-notifiable event within
30 days. Any future aggregator decision inherits both, and the spike doc's
§7 has the detail. This is desk research, **not legal advice**.

An additional, quieter consequence of adopting nothing: ingesting bank data
through an aggregator is the step most likely to pull Runway into GLBA
"financial institution" scope. Declining it does not make that question
disappear — CSV/OFX import maintains the same class of information — but it
does stop Runway becoming the custodian of live, aggregator-issued
credentials for other people's bank accounts.

---

## Consequences

- **#25 (Aggregator integration) is blocked on this decision, not
  unblocked by it.** It should not start. If it is ever revived, it starts
  by re-opening this ADR, not by picking up where the spike left off.
- **#22 (CSV/OFX import) is the automation story** and carries the whole
  weight of "how does data get in without manual entry". It ships on its
  own priority.
- **#26 (Actuals reconciliation) is not blocked.** Its transaction-matching
  work needs *a* source of transactions, and CSV/OFX is one. The field
  names the spike observed are still recorded in the spike doc §5 for
  whatever source #26 ends up matching against.
- **`applyBalanceReadings` remains the right seam** and is unchanged. The
  two conversions an importer owns are the same two an adapter would have:
  decimal string → integer cents via a string parser (never truncation),
  and unix instant → `IsoDate` via `todayIn` with an explicit timezone
  parameter. That analysis survives this decision and applies directly to
  #22 — see spike doc §5.
- **No new dependency, no schema change, no route, nothing shipped to
  users.**
- **`scripts/simplefin-sandbox.ts` was deleted** when this decision landed.
  It was a live integration harness against a vendor Runway is not
  adopting, and keeping runnable integration code for a rejected option
  invites someone to mistake it for the plan. Its output survives verbatim
  in spike doc §5, which is the part that was ever evidence. Recover the
  harness from git history if this is revisited: it last existed at
  `788e6a3`.
- **`scripts/aggregator-cost-model.ts` was kept**, marked superseded. It is
  vendor-neutral and its unit prices are source-cited constants, so on any
  future revisit it is more useful than the frozen tables — prices are the
  thing most likely to have changed.

### Revisiting this decision

There is one trigger, and it is not a technical one:

**A revenue mechanism appears, or the owner decides to absorb the cost
knowingly.** Axis 1's $0 default was set by the absence of any way to pay
for a recurring bill. With one, this decision should be re-argued — and the
spike's evidence says to start with **Stripe Financial Connections**, not
SimpleFIN: it costs Runway $7.20/user/yr rather than costing the user $15,
has the broadest verified coverage (~97% of US bank accounts, ~12,000
institutions `[V]`), and names personal finance apps as a supported use
case `[V]`.

Two secondary triggers worth naming:

- **SimpleFIN's $15/yr turns out to be billed to the app, not the user, and
  to be small enough to absorb.** That would remove objection 3 above,
  though not objection 2.
- **A free, non-Plaid aggregator with real US coverage appears.** None
  exists today; GoCardless Bank Account Data has a free tier but is EU/UK
  only, so it fails the US requirement outright.

The evidence lives at this branch's commits,
`docs/spikes/bank-aggregator-evaluation.md`, and
`scripts/aggregator-cost-model.ts`.

---

## The strongest argument against this

**Runway just declined the entire feature over $7.20 a year, and the
"no revenue mechanism" reasoning is circular.**

At the only scale Runway actually operates at — one user, the owner —
Stripe Financial Connections costs **$7.20 per year**. That is not a
business expense requiring a business model; it is a rounding error against
the domain registration and the Supabase bill this project already pays for
without a revenue mechanism to justify either. The argument "there is no
revenue to cover it" proves too much: by that standard Runway should not
have a hosted database. Invoking the absence of revenue to reject a
seven-dollar annual cost, in a project the owner is already funding out of
pocket, is a different decision than it presents itself as — it is "not
worth it to me", which is a legitimate call, but it is a preference, not an
economic constraint.

And the cost of declining is real. Manual balance entry is the single
biggest source of friction in a cash-flow app, and it degrades exactly when
the app matters most: the projection is only as good as the freshness of
the balances behind it, and a user who has stopped updating balances is a
user whose runway number is quietly wrong. CSV/OFX import narrows that gap
but does not close it — it is still a manual export-download-upload cycle
per institution, which people do once and then stop doing. The spike built
a **working** SimpleFIN connection in three HTTP requests with no signup,
no credit card and no sales call. Throwing that away leaves the automation
story resting entirely on an issue (#22) that has not been built yet.

**Why the decision still stands:** the objection is right that $7.20 is
affordable and wrong that affordability is the question. The cost that
actually matters is not the first user's — it is the shape of the
commitment. A per-connection bill is a recurring obligation that scales
with adoption, arriving in a project with no mechanism to make adoption pay
for itself, and the honest options at that point are to cap signups, eat a
growing bill, or start charging — each of which is a product decision the
owner has not made and should not be forced into as a side effect of a
convenience feature. SimpleFIN's variant is worse on exactly this axis, not
better: it does not scale a bill to Runway, it hands a $15 invoice to every
individual user of a free app, which is the least defensible version of the
trade. Declining now costs one deferred feature and is fully reversible
from git history and this document; adopting now creates an obligation that
is awkward to unwind once real users depend on it. **Given a reversible
wrong answer and an irreversible one, this takes the reversible one.**

That said, the objection's core point is recorded as the revisit trigger
above precisely because it may well be correct later: if the owner decides
he simply wants the feature and will pay $7.20 for it, that is a
one-sentence amendment to this ADR, not a new spike.

---

## What still needs a human

Most of the spike's original list is **moot** — the billing party, the
coverage check, the Stripe eligibility question and the aggregator budget
all existed to gate an adoption that is not happening.

What remains:

1. **Prioritize [#22](https://github.com/JaidenDeChon/runway/issues/22)
   (CSV/OFX import).** It is now the whole automation story rather than one
   of two paths, which is a stronger claim on the roadmap than it had when
   it was filed.
2. **Decide what to do with
   [#25](https://github.com/JaidenDeChon/runway/issues/25) (Aggregator
   integration).** It is blocked indefinitely by this decision. Close it as
   "not now" with a pointer here, or leave it open and parked — but do not
   leave it looking actionable.
3. **Revisit only on the trigger above** — a revenue mechanism, or a
   deliberate decision to absorb the cost. Start from Stripe FC, not
   SimpleFIN.
4. **GLBA scoping still deserves counsel eventually**, because CSV/OFX
   import maintains the same class of consumer financial information that
   an aggregator would. This spike is desk research and is **not legal
   advice**. Declining an aggregator lowers the exposure; it does not
   remove the question.
