import tailwindcss from '@tailwindcss/vite'

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
})
