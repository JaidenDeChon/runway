---
name: humanize-copy
description: Run the copy-humanizer agent on a loop, one file at a time, so every label, message and sentence in Runway is checked against the humanizer skill and rewritten to sound human, and to make sense to someone who has never used the app, without losing details. Use when asked to humanize the app's copy, clean up AI-sounding UI text or docs, or run the humanizer loop. Optional args are a file path to do just that one, a number N to stop after N files, or `docs` to sweep the README and docs/ instead of the app.
---

# Humanize copy on a loop

Drives `.claude/agents/copy-humanizer.md` one file at a time. The agent takes the next file from `bun scripts/humanize-copy.ts next`, goes through its copy string by string (or its prose sentence by sentence) with `.claude/skills/humanizer/SKILL.md`, verifies with `bun scripts/humanize-copy.ts check` and the repo's own checks, records the file in `.claude/humanized-copy.json`, and commits locally. This skill repeats that and pushes the results.

The UI sweep (the default) walks the app screen by screen in the order a new user meets it: the shell and shared controls (navigation, sidebar, header toggles, shared inputs), then signing in, first run, the dashboard, Will I make it?, Accounts, Recurring items, and the server's error messages. Within a screen, the components that name the controls come before the helpers in `app/lib/` and the page whose hints mention those controls, so a hint is rewritten after the button it names has its final name. The order is `UI_ORDER` in the script; a new `.vue` file under `app/` that is not listed there comes after the listed ones.

The docs sweep (`docs`) uses `bun scripts/humanize-copy.ts next --docs`. It walks `README.md`, then `docs/` and the READMEs under `domain/`, starting with what a new developer reads first. Design specs, `CLAUDE.md` and `AGENTS.md` are never in it.

After every file is done once, a file whose content changed since it was humanized comes back into its queue.

## Arguments

- **A file path:** run the agent once on that file, then stop. This is the only way to reach security copy (`shared/auth/errors.ts`, `shared/auth/password.ts`, `server/utils/supabase.ts`), and only when a person asked for it.
- **`docs`** (optionally followed by N): work the docs sweep instead of the UI sweep.
- **A number N:** stop after N files.
- **No arguments:** keep going until the agent reports `ALL DONE`, or something blocks.

## Before the first iteration

Run `bun scripts/humanize-copy.ts status` (with `--docs` for the docs sweep) and tell the user how many files are done and how many remain. Check whether Docker and the local Supabase stack are available (`bun run db:start`), since the agent runs the e2e specs that cover each UI file when it can; tell the user now if it cannot, because every UI commit will then carry e2e specs that nobody ran.

## Each iteration

1. Dispatch the `copy-humanizer` agent in the foreground, one at a time. Pass the file if one was given; otherwise give no target (and in the docs sweep, tell it to work the docs sweep). Never let parallel runs pick their own "next" item: they would take the same one and collide on the ledger.
   - Docs may run in parallel batches if each agent is given an explicit, distinct path and told not to record or commit, because no doc names a control. After the batch, for each doc: run `check`, spot-check it (step 3), then `record` and commit it yourself, one commit per doc. UI files always run one at a time, because a later file's hints, tests and aria labels depend on the names an earlier file settles on, and two UI files can update the same e2e spec.
2. Read its report:
   - **`ALL DONE`** → stop.
   - **A blocker** (uncommitted changes on the file, a check it could not pass without losing meaning, a test failing for another reason) → tell the user what's blocking and stop. Don't retry blindly.
3. Spot-check the commit. `git show --stat HEAD` must touch only that file and the ledger, plus, for a UI file, tests that assert its wording and docs outside `docs/design/` that quote it. Anything else (a design spec, another component, a test line that is not an expectation of the changed wording) is a defect. Then skim `git show HEAD` for a dropped qualifier (*projected*, *predicted*, *estimate*, *previewed*, *not saved*), a changed reach (this day only, every future one), a weakened rule word in a doc, a money amount written into copy, or a changed string from a spec's Copy section. If you find one, fix it in a follow-up commit before moving on.
4. Push every 10 files, and at the end: `git push -u origin <current branch>`. If there's no open PR for the branch, open one. Its body follows "Opening a PR" in `CLAUDE.md`: what changed and why, **How to test** with the exact commands (`bun run lint`, `bun run typecheck`, `bun run test:unit`, and the e2e specs for each screen touched, with `bun run db:start` before them) and a manual walkthrough of each touched screen at 375px and on desktop, in both themes, including the empty states and what-if mode; which of those commands never ran and why; the spec deviations the agents raised; the security copy flagged for review; and a **Still for a human** list. Never push to the default branch.
5. Give the user a one-line status per file: path, strings or sentences changed, main patterns removed. For a UI file, list any renamed control and any spec deviation raised, and pass each rename to every later agent in the sweep so hints, aria labels and tests use the new name.

## Pacing

Each file is a small run, but the UI sweep has about sixty files and each can touch e2e specs. For an unattended sweep, prefer `/loop /humanize-copy 10` or a scheduled Routine that invokes this skill with a number, so each firing does a batch in a fresh context.
