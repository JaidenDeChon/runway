# 0003 — Drop income prediction

**Status:** **decided — not building it.** Settled by the owner on 2026-10-17.
**Date:** 2026-10-17
**Driven by:** [issue #18](https://github.com/JaidenDeChon/runway/issues/18) (Income prediction from history), closed as not planned
**Bears on:** [#26](https://github.com/JaidenDeChon/runway/issues/26) (Actuals reconciliation)

---

## Context

The recurring-items design included "Predict from deposits": an income item's
amount would be the mean of its recent deposits rather than a typed figure, and
#18 extended the same idea to variable bills. `main` carried a first version of
it: an "Amount source" toggle in the recurring-item editor, a predicted-amount
panel, a "Predicted" row badge, `domain/prediction.ts`, and a
`recurring_rules.amount_source` column. None of it could do anything, because
nothing recorded a deposit, so the toggle was always disabled.

PR #95 built the rest: estimates computed live from settled occurrences, an
averaging window on `/accounts`, "Est." markers throughout, and a way to mark an
occurrence paid or received so there would be history to average.

## Decision

Don't build it. The owner concluded the feature isn't helpful. A paycheck or bill that comes in different from its
typed amount is still covered by editing that one occurrence (#15).

## Consequences

- PR #95 was closed unmerged. Its manual paid/received marking went with it,
  since its main purpose was feeding the estimates. #26 stays open for
  reconciliation proper, and the branch `claude/next-board-item-bp27iw` is kept
  in case that work wants the settle RPCs back.
- Migration `20261017120000_remove_income_prediction.sql` drops
  `recurring_rules.amount_source` and its enum, and removes the objects PR #95
  had already put on the hosted database (see that file's header).
- Migration `20261020120000_reset_preview_settlements.sql` puts back any
  occurrence #95's preview marked paid or received. Those `confirmed` rows were
  first left alone as inert, but `override_occurrence` and `revert_occurrence`
  refuse a non-`projected` row, so each one was an occurrence the dashboard
  could no longer edit. They return to `projected`, keeping a hand edit made
  before settling, exactly as #95's own `unsettle_occurrence` did.
- Every income and bill rule is a typed amount. The bill-only `is_variable`
  marker ("Amount varies each cycle", shown as "Est.") stays: it is a label,
  not a prediction, and predates #18.
- `docs/design/recurring-items/spec.md` keeps its prediction sections as
  history, with a notice at the top saying they are not to be built.
