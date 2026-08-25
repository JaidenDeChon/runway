# Golden fixtures

`golden.json` holds the projection engine's exact answer to a set of named
calendar edges. `scenarios.ts` holds the inputs that produce it, and
`../golden.test.ts` compares the two on every run.

They exist because the engine's failure mode is quiet. A bug in a rendering
layer shows up as a broken screen; a bug here shows up as a number that is
merely *wrong*, on a screen that looks exactly as it should. These fixtures make
such a change visible as a diff somebody has to read and agree with.

## What each scenario pins down

| Scenario | The edge |
|---|---|
| `month-boundary-clamp` | A month-end bill lands on Feb 28 and returns to Mar 31 — the clamp does not stick. |
| `leap-day-present` | A rule on the 29th finds a 29th in February 2024 and uses it. |
| `leap-day-absent` | The same rule in 2026 clamps to Feb 28. |
| `dst-spring-forward` | Spans the US (Mar 8) and EU (Mar 29) spring transitions. 26 days, none skipped. |
| `dst-fall-back` | Spans the EU (Oct 25) and US (Nov 1) autumn transitions, and a month boundary with them. |
| `bill-and-income-same-day` | Both land on 2026-02-10. The day nets, and same-day order is by label rather than input order. |
| `empty-window` | Accounts, no events. A flat line, with nothing special-cased. |
| `no-accounts` | No input at all. Empty series, a flat `$0` combined line, no crash. |
| `ninety-days-five-accounts` | The performance scenario, pinned here too so the benchmark cannot drift silently. |

DST is in the list even though the engine has no notion of time-of-day, and that
is the point: date-only arithmetic is what makes a transition day survive as
exactly one day. If someone reaches for a `Date` carrying a time component,
these two fail.

## Regenerating

```sh
bun run test:golden:update && bun run lint:fix
```

The formatter is not optional there: the script writes JSON, Biome decides how
it wraps, and skipping the second half leaves `bun run lint` failing on a file
whose *content* is correct.

**Then read the diff.** A golden file regenerated without looking at what moved
is not a safety net, it is a rubber stamp. Every changed number should be
explainable by a behaviour change you meant to make, and the commit that carries
it should say which. If you cannot name the change, you have found a bug rather
than a stale fixture.

Adding a scenario is the other half of this: when a projection bug is found in
the wild, the fix belongs beside a scenario that reproduces it.
