import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const appDir = fileURLToPath(new URL('./app/', import.meta.url))
const rootDir = fileURLToPath(new URL('./', import.meta.url))

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
    ],
  },
})
