import tailwindcss from '@tailwindcss/vite'

// Build-time only. RUNWAY_LAB decides whether the bake-off route tree
// (app/pages/lab/chart-bakeoff/, issue #10) is compiled at all, so a
// production build ships none of the candidate chart libraries. This is
// deliberately a `process.env` read at config-eval time — the opposite of the
// runtimeConfig rule below it, and for the opposite reason: which routes exist
// is settled when the bundle is built, not when the server starts.
//
//   unset or '0' — no lab routes at all (the production default)
//   '1' or 'all' — every candidate page
//   a candidate slug ('svg', 'unovis', 'echarts', 'chartjs', 'vue-chrts') —
//     only that candidate's page, plus the shared index
//
// The per-slug mode is load-bearing, not a nicety: `scripts/bakeoff-bundle.ts`
// measures one candidate's cost at a time, and that number is only honest if
// every *other* candidate's imports are out of the page graph entirely —
// removing a page from `pages:extend` is what keeps them out.
const lab = process.env.RUNWAY_LAB ?? ''
const labIncludesAll = lab === '1' || lab === 'all'
const labIncludesNone = lab === '' || lab === '0'
const LAB_PATH_PREFIX = '/lab/'
const LAB_INDEX_PATH = '/lab/chart-bakeoff'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxtjs/color-mode'],

  // shadcn-vue writes both `Sidebar.vue` and `index.ts` into
  // app/components/ui/sidebar/. Nuxt's default component scan picks up both
  // and emits ten NUXT_B3011 "two component files resolving to the same name"
  // warnings on every prepare/dev/build. Restricting the scan to .vue removes
  // all of them. UI primitives are imported explicitly from
  // '@/components/ui/*' anyway, so nothing depends on their auto-registration.
  components: [{ path: '~/components', extensions: ['vue'] }],

  css: ['~/assets/css/tailwind.css'],

  hooks: {
    // Removes the bake-off's route tree from the page graph rather than hiding
    // it behind a runtime check — a runtime check still ships the code that
    // decides to hide it, which is exactly the bundle weight this gate exists
    // to keep out of production. See the RUNWAY_LAB comment above.
    'pages:extend'(pages) {
      for (let i = pages.length - 1; i >= 0; i--) {
        const page = pages[i]
        if (!page || !page.path.startsWith(LAB_PATH_PREFIX)) continue
        if (labIncludesNone) {
          pages.splice(i, 1)
          continue
        }
        if (labIncludesAll) continue
        // Per-slug mode: keep the shared index (it links to every candidate,
        // but a page it merely links to does not pull that candidate's chart
        // library into *its* chunk) plus exactly the selected candidate's page.
        const isSelected = page.path === `${LAB_INDEX_PATH}/${lab}`
        if (page.path !== LAB_INDEX_PATH && !isSelected) pages.splice(i, 1)
      }
    },
  },

  colorMode: {
    classSuffix: '',
    preference: 'system',
    fallback: 'light',
    storageKey: 'runway-color-mode',
  },

  // Strict is Nuxt 4's default; stated explicitly because it is
  // non-negotiable for a money app. typeCheck stays false so builds are fast:
  // `bun run typecheck` is a separate, CI-enforced gate.
  typescript: { strict: true, typeCheck: false },

  vite: {
    plugins: [tailwindcss()],
  },

  // Supabase credentials arrive from the environment at RUNTIME, not build time.
  // Nuxt binds NUXT_PUBLIC_SUPABASE_URL -> public.supabase.url and
  // NUXT_SUPABASE_SERVICE_ROLE_KEY -> supabase.serviceRoleKey automatically, so
  // nothing here reads process.env: a `process.env` read at config-eval time
  // bakes the value into the build and defeats Netlify's runtime environment.
  // Keys inside `public` reach the browser. Keys outside it never do.
  runtimeConfig: {
    supabase: {
      serviceRoleKey: '',
    },
    public: {
      supabase: {
        url: '',
        anonKey: '',
      },
    },
  },
})
