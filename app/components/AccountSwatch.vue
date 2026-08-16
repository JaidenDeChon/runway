<script setup lang="ts">
/**
 * The round dot standing for an account's line colour.
 *
 * Always decorative: colour is never the only thing identifying an account —
 * the name is adjacent everywhere this appears — so it is hidden from assistive
 * tech rather than given a colour name nobody needs read aloud.
 */
import { computed } from 'vue'
import { accountColorClasses } from '@/lib/account-colors'
import { cn } from '@/lib/utils'
import type { AccountColor } from '~~/domain/types'

const props = withDefaults(defineProps<{ color: AccountColor; size?: 'sm' | 'base' }>(), {
  size: 'base',
})

const classes = computed(() => accountColorClasses(props.color))
</script>

<template>
  <span
    aria-hidden="true"
    :class="
      cn(
        'inline-block shrink-0 rounded-full',
        props.size === 'sm' ? 'size-2' : 'size-2.5',
        classes.background,
      )
    "
  />
</template>
