<script setup lang="ts">
/**
 * Set a new password, having arrived from an emailed recovery link.
 *
 * The visitor here is *authenticated* — `/auth/confirm` exchanged their
 * recovery token for a session before redirecting — which is why this route is
 * classified `public` rather than `guest-only` in `#shared/auth/routes`: the
 * guest-only rule would bounce them to the dashboard one step short of the
 * thing they came to do.
 *
 * Arriving without that session is the ordinary failure — a link that expired,
 * or one opened twice. It is stated plainly, with the way to get a fresh one,
 * rather than left as a form that fails on submit.
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
useHead({ title: 'Set a new password · Runway' })

const { updatePassword } = useAuthActions()
const user = useAuthUser()
const ready = useAuthReady()

const password = ref('')
const confirmation = ref('')
const busy = ref(false)
const result = ref<AuthActionResult | null>(null)

const hasRecoverySession = computed(() => !ready.value || user.value !== null)
const tooShort = computed(
  () => password.value.length > 0 && password.value.length < MINIMUM_PASSWORD_LENGTH,
)
const mismatched = computed(
  () => confirmation.value.length > 0 && confirmation.value !== password.value,
)
const canSubmit = computed(
  () =>
    !busy.value &&
    password.value.length >= MINIMUM_PASSWORD_LENGTH &&
    confirmation.value === password.value,
)

async function onSubmit(): Promise<void> {
  if (!canSubmit.value) return
  busy.value = true
  result.value = null
  try {
    result.value = await updatePassword(password.value)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AuthCard
    title="Set a new password"
    description="Choose something you haven't used here before."
  >
    <template v-if="hasRecoverySession">
      <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
        <div class="flex flex-col gap-2">
          <Label for="reset-password-new">New password</Label>
          <Input
            id="reset-password-new"
            v-model="password"
            type="password"
            autocomplete="new-password"
            required
            :aria-describedby="tooShort ? 'reset-password-hint' : undefined"
            :aria-invalid="tooShort || undefined"
          />
          <p
            id="reset-password-hint"
            class="text-xs"
            :class="tooShort ? 'text-destructive' : 'text-muted-foreground'"
          >
            {{ PASSWORD_RULE_TEXT }}
          </p>
        </div>

        <div class="flex flex-col gap-2">
          <Label for="reset-password-confirmation">Confirm new password</Label>
          <Input
            id="reset-password-confirmation"
            v-model="confirmation"
            type="password"
            autocomplete="new-password"
            required
            :aria-describedby="mismatched ? 'reset-password-confirmation-hint' : undefined"
            :aria-invalid="mismatched || undefined"
          />
          <p
            v-if="mismatched"
            id="reset-password-confirmation-hint"
            class="text-xs text-destructive"
          >
            Those two passwords don't match.
          </p>
        </div>

        <Button type="submit" :disabled="!canSubmit">
          {{ busy ? 'Saving…' : 'Save new password' }}
        </Button>
      </form>

      <AuthMessage :text="result?.message ?? null" :tone="result?.tone ?? 'notice'" />
    </template>

    <template v-else>
      <AuthMessage
        text="That reset link has expired or has already been used. Ask for a new one."
        tone="error"
      />
      <Button as-child>
        <NuxtLink to="/forgot-password">Email me a new link</NuxtLink>
      </Button>
    </template>
  </AuthCard>
</template>
