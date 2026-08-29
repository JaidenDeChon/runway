<script setup lang="ts">
/**
 * The feedback line on an auth form.
 *
 * `role="status"` for a notice and `role="alert"` for a failure, so a screen
 * reader announces "check your inbox" without interrupting, and announces a
 * rejected password immediately. `Alert` already carries `role="alert"`, which
 * is wrong for the notice case, hence the explicit element here.
 *
 * The text it renders always comes from `#shared/auth/errors`, never from a
 * provider message — see that module for why.
 */
import { CircleAlert, Info } from '@lucide/vue'
import { Alert, AlertDescription } from '@/components/ui/alert'

const props = defineProps<{
  /** `null` renders nothing at all, rather than an empty box that shifts the layout. */
  text: string | null
  tone: 'error' | 'notice'
}>()
</script>

<template>
  <Alert
    v-if="props.text"
    :variant="props.tone === 'error' ? 'destructive' : 'default'"
    :role="props.tone === 'error' ? 'alert' : 'status'"
    :aria-live="props.tone === 'error' ? 'assertive' : 'polite'"
  >
    <CircleAlert v-if="props.tone === 'error'" />
    <Info v-else />
    <AlertDescription>{{ props.text }}</AlertDescription>
  </Alert>
</template>
