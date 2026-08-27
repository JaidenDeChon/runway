<script setup lang="ts">
/**
 * The one card every auth screen is. Exists so four pages cannot drift into
 * four slightly different headers.
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
      <CardTitle class="text-lg">{{ title }}</CardTitle>
      <CardDescription>{{ description }}</CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-4">
      <slot />
    </CardContent>
  </Card>
</template>
