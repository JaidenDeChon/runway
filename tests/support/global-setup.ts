/**
 * Global setup for the `integration` Vitest project — `tests/rls/` and
 * `tests/integration/` alike.
 *
 * It does two things: resolves the local stack once for every worker, and
 * enforces the suite's wall-clock budget on the way out.
 *
 * On a developer machine a missing stack deliberately does NOT throw. `bun run
 * test` runs every project, and someone without Docker running should still get
 * a green suite — the database files skip themselves and say why.
 *
 * That leniency is exactly wrong in CI, where a skipped suite is
 * indistinguishable from a passing one and the whole point of these tests is
 * that they are the proof. Set `RUNWAY_RLS_REQUIRE_STACK=1` and a missing stack
 * becomes a hard failure instead — see the `database` job in
 * .github/workflows/ci.yml.
 *
 * A stack that is *reachable but not local* is never tolerated, in either
 * environment. See tests/support/stack.ts.
 */

import { publishStackToEnvironment, resolveStack } from './stack'

const MISSING_STACK = [
  '',
  '  [integration] Local Supabase stack is not running — database tests will be SKIPPED.',
  '  [integration] These tests are the proof that the database denies by default;',
  '  [integration] a green run without them proves nothing.',
  '',
  '  [integration] Start it with:  bun run db:start     (requires Docker)',
  '',
].join('\n')

/**
 * The per-PR wall-clock budget for the whole integration project.
 *
 * The issue's requirement is "stay fast enough to run on every PR; budget it
 * and enforce the budget", and this is the enforcement. Like the projection
 * engine's benchmark, the number is deliberately far above the observed cost:
 * a CI runner is a shared, noisy machine, and a budget that fails on a busy
 * afternoon gets deleted rather than investigated.
 *
 * What this catches is not a 20% regression. It is somebody adding a per-test
 * `supabase db reset`, or a helper that signs in inside a loop — the changes
 * that take a suite from "runs on every PR" to "runs nightly, if anyone
 * remembers".
 *
 * Override with `RUNWAY_INTEGRATION_BUDGET_MS` when bisecting something slow.
 */
const DEFAULT_BUDGET_MS = 300_000

function budgetMillis(): number {
  const raw = process.env.RUNWAY_INTEGRATION_BUDGET_MS
  if (!raw) return DEFAULT_BUDGET_MS
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`RUNWAY_INTEGRATION_BUDGET_MS must be a positive number of milliseconds`)
  }
  return parsed
}

export default function setup(): () => void {
  const startedAt = Date.now()
  const stack = resolveStack()

  if (!stack) {
    if (process.env.RUNWAY_RLS_REQUIRE_STACK === '1') {
      throw new Error(
        'RUNWAY_RLS_REQUIRE_STACK=1 but the local Supabase stack is not reachable. ' +
          'Refusing to skip the integration suite: skipping it here would report a green run ' +
          'for a database nothing has checked.',
      )
    }
    console.warn(MISSING_STACK)
    // Falls through to the same teardown. With everything skipped the suite
    // finishes in about a second and the budget is never near — but installing
    // it unconditionally means the mechanism is exercised on every run rather
    // than only on machines with Docker, which is how it stays working.
  } else {
    publishStackToEnvironment(stack)
  }

  return () => enforceBudget(startedAt)
}

/**
 * Fails the run when the suite ran long.
 *
 * `process.exitCode`, not `throw`, and that is not a style preference — it is
 * the difference between this working and not working. Vitest catches an error
 * thrown from a globalSetup teardown, prints it as "error during close", and
 * then **exits 0 anyway**: the run is reported as passing and CI goes green. A
 * budget enforced that way is decorative, which is precisely the kind of check
 * that gets mistaken for evidence. Setting the exit code directly is what
 * actually fails the run; verified both ways before this was written.
 */
function enforceBudget(startedAt: number): void {
  const elapsed = Date.now() - startedAt
  const budget = budgetMillis()
  if (elapsed <= budget) return

  console.error(
    [
      '',
      `  [integration] OVER BUDGET: the suite took ${(elapsed / 1000).toFixed(1)}s, ` +
        `against a ${(budget / 1000).toFixed(0)}s ceiling.`,
      '',
      '  [integration] This suite runs on every pull request; that is the constraint it is',
      '  [integration] being held to. Either make it faster, or move the budget in',
      '  [integration] tests/support/global-setup.ts deliberately, with a reason.',
      '',
    ].join('\n'),
  )
  process.exitCode = 1
}
