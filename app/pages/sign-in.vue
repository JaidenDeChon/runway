<script setup lang="ts">
/**
 * Sign in — the first screen a returning user sees.
 *
 * One screen, per the issue: password and magic link are two tabs on one card
 * rather than two routes, so nobody has to find the other one. Sign-up and
 * password reset are links, because they are genuinely different intents.
 *
 * Nothing here interprets a provider error. Every string the user sees comes
 * from `#shared/auth/errors`, which is where the "never reveal whether an email
 * is registered" rule is enforced and tested.
 */
import { ref } from 'vue'
import AuthCard from '@/components/auth/AuthCard.vue'
import AuthMessage from '@/components/auth/AuthMessage.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { AuthActionResult } from '@/composables/useAuthActions'

definePageMeta({ layout: 'auth' })
useHead({ title: 'Sign in · Runway' })

const { signInWithPassword, signInWithMagicLink } = useAuthActions()

const email = ref('')
const password = ref('')
const busy = ref(false)
const result = ref<AuthActionResult | null>(null)

async function run(action: () => Promise<AuthActionResult>): Promise<void> {
  if (busy.value) return
  busy.value = true
  result.value = null
  try {
    result.value = await action()
  } finally {
    busy.value = false
  }
}

const onPasswordSubmit = () => run(() => signInWithPassword(email.value, password.value))
const onMagicLinkSubmit = () => run(() => signInWithMagicLink(email.value))
</script>

<template>
  <AuthCard title="Sign in" description="Pick up where your money left off.">
    <Tabs default-value="password" class="gap-4">
      <TabsList class="w-full">
        <TabsTrigger value="password" class="flex-1">Password</TabsTrigger>
        <TabsTrigger value="magic-link" class="flex-1">Email link</TabsTrigger>
      </TabsList>

      <TabsContent value="password">
        <form class="flex flex-col gap-4" @submit.prevent="onPasswordSubmit">
          <div class="flex flex-col gap-2">
            <Label for="sign-in-email">Email</Label>
            <Input
              id="sign-in-email"
              v-model="email"
              type="email"
              autocomplete="email"
              required
              placeholder="you@example.com"
            />
          </div>

          <div class="flex flex-col gap-2">
            <div class="flex items-baseline justify-between gap-2">
              <Label for="sign-in-password">Password</Label>
              <NuxtLink
                to="/forgot-password"
                class="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                Forgot password?
              </NuxtLink>
            </div>
            <Input
              id="sign-in-password"
              v-model="password"
              type="password"
              autocomplete="current-password"
              required
            />
          </div>

          <Button type="submit" :disabled="busy">
            {{ busy ? 'Signing in…' : 'Sign in' }}
          </Button>
        </form>
      </TabsContent>

      <TabsContent value="magic-link">
        <form class="flex flex-col gap-4" @submit.prevent="onMagicLinkSubmit">
          <div class="flex flex-col gap-2">
            <Label for="magic-link-email">Email</Label>
            <Input
              id="magic-link-email"
              v-model="email"
              type="email"
              autocomplete="email"
              required
              placeholder="you@example.com"
            />
            <p class="text-xs text-muted-foreground">
              We'll email a link that signs you in. No password needed.
            </p>
          </div>

          <Button type="submit" :disabled="busy">
            {{ busy ? 'Sending…' : 'Email me a link' }}
          </Button>
        </form>
      </TabsContent>
    </Tabs>

    <AuthMessage :text="result?.message ?? null" :tone="result?.tone ?? 'notice'" />

    <p class="text-center text-sm text-muted-foreground">
      New here?
      <NuxtLink to="/sign-up" class="text-foreground underline underline-offset-4">
        Create an account
      </NuxtLink>
    </p>
  </AuthCard>
</template>
