<script setup lang="ts">
/**
 * The chrome around sign-in: a wordmark, one card, nothing else.
 *
 * No sidebar and no breadcrumb, for the same reason `onboarding.vue` has
 * neither — these screens are reached before there is anything to navigate to,
 * and the issue asks for sign-in to be "the first thing a new user sees; keep
 * it to one screen".
 *
 * **This screen has no design artifact.** There is no `docs/design/sign-in/`,
 * so per `CLAUDE.md` this is built from the repo's own conventions rather than
 * from a spec: the same `max-w-[480px]` column and wordmark as
 * `onboarding.vue`, `shadcn-vue` Card / Input / Label / Button, and tokens
 * only. Nothing here is invented from a screenshot, and every value is a token.
 * It is raised in the pull request as the deviation it is.
 */
</script>

<template>
  <div class="flex min-h-svh flex-col">
    <div
      class="mx-auto flex w-full max-w-[480px] flex-1 flex-col justify-center gap-6 px-4 py-8 lg:py-12"
    >
      <header class="flex items-center justify-center">
        <span class="text-lg font-semibold tracking-tight lg:text-xl">Runway</span>
      </header>

      <slot />
    </div>
  </div>
</template>
