<script setup lang="ts">
/**
 * Ask for a password-reset link.
 *
 * The acknowledgement is identical whether or not the address has an account —
 * that is the point of the screen, and it is enforced in
 * `#shared/auth/errors`, not here. The form is also left on screen afterwards
 * rather than replaced, so somebody who mistyped can correct it without going
 * back.
 */
import { computed, ref } from 'vue'
import AuthCard from '@/components/auth/AuthCard.vue'
import AuthMessage from '@/components/auth/AuthMessage.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { AuthActionResult } from '@/composables/useAuthActions'

definePageMeta({ layout: 'auth' })
useHead({ title: 'Reset your password · Runway' })

const { requestPasswordReset } = useAuthActions()

const email = ref('')
const busy = ref(false)
const result = ref<AuthActionResult | null>(null)

const canSubmit = computed(() => !busy.value && email.value.trim().length > 0)

async function onSubmit(): Promise<void> {
  if (!canSubmit.value) return
  busy.value = true
  result.value = null
  try {
    result.value = await requestPasswordReset(email.value)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AuthCard
    title="Reset your password"
    description="We'll email you a link to set a new one."
  >
    <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
      <div class="flex flex-col gap-2">
        <Label for="forgot-password-email">Email</Label>
        <Input
          id="forgot-password-email"
          v-model="email"
          type="email"
          autocomplete="email"
          required
          placeholder="you@example.com"
        />
      </div>

      <Button type="submit" :disabled="!canSubmit">
        {{ busy ? 'Sending…' : 'Email me a link' }}
      </Button>
    </form>

    <AuthMessage :text="result?.message ?? null" :tone="result?.tone ?? 'notice'" />

    <p class="text-center text-sm text-muted-foreground">
      <NuxtLink to="/sign-in" class="text-foreground underline underline-offset-4">
        Back to sign in
      </NuxtLink>
    </p>
  </AuthCard>
</template>
