<script setup lang="ts">
/**
 * Create an account.
 *
 * The confirm-password field is client-side only and deliberately so: it
 * catches a typo in the one field the user cannot see, which is a usability
 * problem, not a security one. The password rule shown is the floor the project
 * is configured with — `minimum_password_length` in `supabase/config.toml`,
 * and the matching setting on the hosted project. GoTrue is the authority on
 * whether a password is acceptable; this form only avoids wasting a round trip.
 *
 * On success the user either lands in the app (a project with email
 * confirmation off) or is told to check their inbox (one with it on). Both
 * paths are handled in `useAuthActions().signUp` rather than assumed here.
 */
import { computed, ref } from 'vue'
import { MINIMUM_PASSWORD_LENGTH, PASSWORD_RULE_TEXT } from '#shared/auth/password'
import AuthCard from '@/components/auth/AuthCard.vue'
import AuthMessage from '@/components/auth/AuthMessage.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { AuthActionResult } from '@/composables/useAuthActions'

definePageMeta({ layout: 'auth' })
useHead({ title: 'Create an account · Runway' })

const { signUp } = useAuthActions()

const email = ref('')
const password = ref('')
const confirmation = ref('')
const busy = ref(false)
const result = ref<AuthActionResult | null>(null)

const tooShort = computed(
  () => password.value.length > 0 && password.value.length < MINIMUM_PASSWORD_LENGTH,
)
const mismatched = computed(
  () => confirmation.value.length > 0 && confirmation.value !== password.value,
)
const canSubmit = computed(
  () =>
    !busy.value &&
    email.value.trim().length > 0 &&
    password.value.length >= MINIMUM_PASSWORD_LENGTH &&
    confirmation.value === password.value,
)

async function onSubmit(): Promise<void> {
  if (!canSubmit.value) return
  busy.value = true
  result.value = null
  try {
    result.value = await signUp(email.value, password.value)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AuthCard title="Create an account" description="Runway keeps your projection to yourself.">
    <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
      <div class="flex flex-col gap-2">
        <Label for="sign-up-email">Email</Label>
        <Input
          id="sign-up-email"
          v-model="email"
          type="email"
          autocomplete="email"
          required
          placeholder="you@example.com"
        />
      </div>

      <div class="flex flex-col gap-2">
        <Label for="sign-up-password">Password</Label>
        <Input
          id="sign-up-password"
          v-model="password"
          type="password"
          autocomplete="new-password"
          required
          :aria-describedby="tooShort ? 'sign-up-password-hint' : undefined"
          :aria-invalid="tooShort || undefined"
        />
        <p
          id="sign-up-password-hint"
          class="text-xs"
          :class="tooShort ? 'text-destructive' : 'text-muted-foreground'"
        >
          {{ PASSWORD_RULE_TEXT }}
        </p>
      </div>

      <div class="flex flex-col gap-2">
        <Label for="sign-up-confirmation">Confirm password</Label>
        <Input
          id="sign-up-confirmation"
          v-model="confirmation"
          type="password"
          autocomplete="new-password"
          required
          :aria-describedby="mismatched ? 'sign-up-confirmation-hint' : undefined"
          :aria-invalid="mismatched || undefined"
        />
        <p v-if="mismatched" id="sign-up-confirmation-hint" class="text-xs text-destructive">
          Those two passwords don't match.
        </p>
      </div>

      <Button type="submit" :disabled="!canSubmit">
        {{ busy ? 'Creating account…' : 'Create account' }}
      </Button>
    </form>

    <AuthMessage :text="result?.message ?? null" :tone="result?.tone ?? 'notice'" />

    <p class="text-center text-sm text-muted-foreground">
      Already have an account?
      <NuxtLink to="/sign-in" class="text-foreground underline underline-offset-4">Sign in</NuxtLink>
    </p>
  </AuthCard>
</template>
