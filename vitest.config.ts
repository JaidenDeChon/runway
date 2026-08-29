import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const appDir = fileURLToPath(new URL('./app/', import.meta.url))
const rootDir = fileURLToPath(new URL('./', import.meta.url))
const sharedDir = fileURLToPath(new URL('./shared/', import.meta.url))

export default defineConfig({
  test: {
    projects: [
      {
        // Pure-node unit tests. No Nuxt boot, no DOM, no Vue plugin.
        // `app/lib/*` and `domain/*` must both remain importable under these terms.
        //
        // `tests/domain/` holds the tests *about* the domain that cannot live
        // inside it: purity is checked by reading the source files, and
        // `domain/**` is lint-banned from importing `node:*`. Everything that
        // can live beside its module still does.
        test: {
          name: 'unit',
          environment: 'node',
          include: [
            'app/lib/**/*.test.ts',
            'app/utils/**/*.test.ts',
            // `shared/` is Nuxt's both-sides directory: the session and route
            // utilities there are imported by the browser, by server-side
            // rendering and by Nitro handlers alike, so their tests belong in
            // the project that boots none of those.
            'shared/**/*.test.ts',
            'domain/**/*.test.ts',
            'tests/domain/**/*.test.ts',
          ],
        },
        resolve: {
          // Mirrors Nuxt's aliases so `@/lib/...` and `#shared/...` resolve the
          // same way they do at runtime.
          alias: { '@': appDir, '~': appDir, '@@': rootDir, '~~': rootDir, '#shared': sharedDir },
        },
      },
      // Component tests are deliberately absent. Nuxt-env component testing
      // (`@nuxt/test-utils`, `happy-dom`, `@vue/test-utils`) still has no
      // project here: issue #5 delivered the *integration* and *E2E* halves of
      // its scope, and a component project whose include glob matches nothing
      // is dead weight. Add it with its first component spec, not before.
      {
        // Live-database integration tests. Needs Docker and a running local
        // Supabase stack; skips itself with a warning when the stack is down, so
        // `bun run test` stays green for someone without Docker.
        //
        // Two directories, one project, on purpose. `tests/rls/` proves the
        // security posture and `tests/integration/` proves the data layer and
        // the harness itself, but they share seed users, clients, an admin
        // connection and a stack — running them as two projects would mean two
        // copies of all of that and two answers to "which user is A".
        //
        // fileParallelism/concurrent are OFF and must stay off: the negative
        // control in tests/rls/negative-control.test.ts commits a
        // deliberately-wide policy and restores it, which corrupts any test file
        // running alongside it.
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/rls/**/*.test.ts', 'tests/integration/**/*.test.ts'],
          globalSetup: ['./tests/support/global-setup.ts'],
          fileParallelism: false,
          sequence: { concurrent: false },
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
        resolve: {
          alias: { '@': appDir, '~': appDir, '@@': rootDir, '~~': rootDir, '#shared': sharedDir },
        },
      },
    ],
  },
})
