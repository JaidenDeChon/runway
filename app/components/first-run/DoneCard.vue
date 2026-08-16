<script setup lang="ts">
/**
 * The done state. `summary` arrives fully composed — the sign, the money
 * string and the fallback names are all resolved in `first-run.vue` from
 * already-formatted parts, so nothing here does arithmetic or formatting.
 */
import { Button } from '@/components/ui/button'
import { CardContent, CardDescription, CardTitle } from '@/components/ui/card'

defineProps<{ summary: string }>()
</script>

<template>
  <CardContent class="flex flex-col items-center gap-4 text-center">
    <CardTitle class="text-xl">You're set.</CardTitle>
    <CardDescription class="text-sm">{{ summary }}</CardDescription>
    <Button as-child class="w-full">
      <NuxtLink to="/">See your runway</NuxtLink>
    </Button>
    <p class="text-xs text-muted-foreground">Add more accounts and bills any time from the menu.</p>
  </CardContent>
</template>
