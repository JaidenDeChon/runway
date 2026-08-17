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
        test: {
          name: 'unit',
          environment: 'node',
          include: ['app/lib/**/*.test.ts', 'app/utils/**/*.test.ts', 'domain/**/*.test.ts'],
        },
        resolve: {
          // Mirrors Nuxt's aliases so `@/lib/...` resolves the same way it does at runtime.
          alias: { '@': appDir, '~': appDir, '@@': rootDir, '~~': rootDir },
        },
      },
      // Component tests are deliberately absent. When issue #5 lands the
      // integration/E2E harness, add a second project here:
      //
      //   { plugins: [vue()],
      //     test: { name: 'component', environment: 'happy-dom',
      //             include: ['app/components/**/*.spec.ts'] } }
      //
      // and the devDependencies `@vitejs/plugin-vue`, `happy-dom`, `@vue/test-utils`.
      // Do not add them now: a project whose include glob matches nothing is
      // dead weight, and Nuxt-env testing (`@nuxt/test-utils`) belongs to #5.
      {
        // Live-database RLS tests. Needs Docker and a running local Supabase
        // stack; skips itself with a warning when the stack is down, so
        // `bun run test` stays green for someone without Docker.
        //
        // fileParallelism/concurrent are OFF and must stay off: the negative
        // control in negative-control.test.ts commits a deliberately-wide policy
        // and restores it, which corrupts any test file running alongside it.
        test: {
          name: 'rls',
          environment: 'node',
          include: ['tests/rls/**/*.test.ts'],
          globalSetup: ['./tests/rls/global-setup.ts'],
          fileParallelism: false,
          sequence: { concurrent: false },
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
        resolve: {
          alias: { '@': appDir, '~': appDir, '@@': rootDir, '~~': rootDir, '#shared': sharedDir },
        },
      },
    ],
  },
})
