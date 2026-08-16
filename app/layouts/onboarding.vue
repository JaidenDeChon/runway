<script setup lang="ts">
/**
 * Onboarding's own chrome: a wordmark and an escape hatch, nothing else.
 *
 * No sidebar, no breadcrumb — `first-run` is reached before there is anything
 * to navigate to. "Skip to dashboard" stays reachable on every step, including
 * the done state, per the spec.
 */
</script>

<template>
  <div class="min-h-svh">
    <div class="mx-auto flex w-full max-w-[480px] flex-col gap-6 px-4 py-4 lg:py-6">
      <header class="flex items-center justify-between">
        <span class="text-base font-semibold tracking-tight lg:text-lg">Runway</span>
        <NuxtLink to="/" class="text-sm text-muted-foreground transition-colors hover:text-foreground">
          Skip to dashboard
        </NuxtLink>
      </header>

      <slot />
    </div>
  </div>
</template>
