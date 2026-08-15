<script setup lang="ts">
import { Moon, Sun } from '@lucide/vue'
import { Button } from '@/components/ui/button'

const colorMode = useColorMode()

// `colorMode.value` is read only inside this handler. Reading it during render
// would differ between SSR (unknown) and client (resolved) and produce a
// hydration mismatch — the icons above are swapped purely by the `dark:` CSS
// variant, which @nuxtjs/color-mode's pre-paint inline script has already settled.
function toggleTheme() {
  colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
}
</script>

<template>
  <Button variant="ghost" size="icon-sm" @click="toggleTheme">
    <Sun class="size-4 dark:hidden" />
    <Moon class="hidden size-4 dark:block" />
    <span class="sr-only">Toggle theme</span>
  </Button>
</template>
