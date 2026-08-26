# Agents

The agents in `.claude/agents/` drive work on the GitHub project board. They are
plain markdown with YAML frontmatter, so any harness that reads `.claude/agents/`
picks them up — nothing here is specific to one client.

## The fleet

| Agent | Model / effort | Role |
| --- | --- | --- |
| `gh-board-runner` | Opus, medium | Works the board continuously. Picks the next task, hands it to `gh-task`, decides whether the PR self-merges or waits for you, repeats. |
| `gh-task` | Opus, high | Runs one task end to end: resolve → plan → delegate → verify → PR → review. |
| `gh-task-planner-xhigh` | Opus, xhigh | Planning for cross-cutting tasks. |
| `gh-task-planner-max` | Opus, max | Planning for architectural or high-blast-radius tasks. |
| `gh-task-implementer` | Sonnet, high | Writes the code for a plan. Default. |
| `gh-task-implementer-med` | Sonnet, medium | Writes the code for fully-specified mechanical plans. |
| `gh-task-reviewer` | Opus, high | Adversarial review of the resulting PR. |

The split is deliberate and it is about cost: **Opus decides, Sonnet types.**
Planning is where a wrong call is expensive, so it gets the expensive model at a
high effort tier. Implementation follows a plan that has already made the
decisions, so it goes to Sonnet. Anything that inverts that — Opus writing
components, Sonnet choosing a data model — is a bug in how the work was routed.

## Running the board

Start or resume the runner:

```
Use the gh-board-runner agent to work the Runway board.
```

It is re-entrant by design. Invoking it again after it stops — for any reason —
resumes from its checkpoint rather than starting over, so it is safe to put on a
loop and leave alone:

```
/loop 30m Use the gh-board-runner agent to work the Runway board.
```

## What it does without asking, and what it doesn't

**Held for your review, always:** anything labeled `feature` or `spike`, anything
touching auth, RLS, migrations, `domain/` projection math, money handling, secrets
or CI permissions, anything that changes a screen, and anything where the
adversarial reviewer left a finding. Held PRs get the `needs-review` label and the
runner moves on to the next task — your review latency never blocks the build.

**Self-merged:** narrow chores only — lint and config alignment, green dependency
patch bumps, test-only additions, docs fixes, dead code removal — and only with CI
green and zero reviewer findings. Every self-merge posts a comment on the PR naming
the rule it merged under, so the runner's judgment stays auditable. When two rules
seem to both apply, it holds.

Your review feedback is the highest-priority work in the system: the runner
services commented PRs before it starts anything new.

## Rate limits

A rate limit ends a turn with no error to catch, so every agent in the fleet
checkpoints rather than trusting its own context:

- plans are written to `.claude/runway-runner/tasks/<issue>/plan.md` **before** an
  implementer is spawned — a lost plan is the one genuinely expensive loss;
- implementers commit and push as they go, so work lives on a remote branch, not
  in a container's working tree;
- reviewers post findings to the PR rather than only returning them;
- phase, branch, and next step are mirrored into a single `<!-- runway-runner -->`
  comment on the issue.

`.claude/runway-runner/` is git-ignored — it is run state. The durable record is
the board, the issues, and the PRs. Resuming re-reads all of it, so a run killed
mid-task costs one recovery step and no re-planning.
