<script setup lang="ts">
/**
 * Where a link that did not work lands.
 *
 * It says nothing about *why*. A recovery link that has expired, one that has
 * already been used, and one whose PKCE verifier belongs to a different browser
 * are the same message here, because distinguishing them tells whoever is
 * holding the link something about the account it belongs to. The way forward
 * is the same in all three cases, so there is nothing to lose by conflating
 * them.
 *
 * `/auth/confirm` redirects here rather than rendering an error itself, so no
 * failure detail ever reaches a URL — a query parameter is both an injection
 * sink and something that ends up in a referrer header.
 */
import AuthCard from '@/components/auth/AuthCard.vue'
import { Button } from '@/components/ui/button'

definePageMeta({ layout: 'auth' })
useHead({ title: 'That link did not work · Runway' })
</script>

<template>
  <AuthCard
    title="That link didn't work"
    description="Email links are single-use and expire quickly. This one has done one or the other."
  >
    <div class="flex flex-col gap-2">
      <Button as-child>
        <NuxtLink to="/sign-in">Back to sign in</NuxtLink>
      </Button>
      <Button as-child variant="ghost">
        <NuxtLink to="/forgot-password">Email me a new link</NuxtLink>
      </Button>
    </div>
  </AuthCard>
</template>
