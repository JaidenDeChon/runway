<script setup lang="ts">
/**
 * The one card every auth screen is. Exists so four pages cannot drift into
 * four slightly different headers.
 *
 * The title renders as an `h1`, not the registry default `div`. These screens
 * are a whole page that happens to be one card, so their title *is* the
 * document's heading — without this the page exposes no heading at all, and a
 * screen reader jumping by heading lands nowhere. Every other card in the app
 * is a section among many and correctly keeps the `div`.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

defineProps<{
  title: string
  description: string
}>()
</script>

<template>
  <Card class="gap-4 py-6">
    <CardHeader class="gap-1">
      <CardTitle as="h1" class="text-lg">{{ title }}</CardTitle>
      <CardDescription>{{ description }}</CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-4">
      <slot />
    </CardContent>
  </Card>
</template>
