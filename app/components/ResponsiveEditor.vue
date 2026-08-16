<script setup lang="ts">
/**
 * An editor that is a bottom Sheet on mobile and a centered Dialog on desktop.
 *
 * This is the structural detail the accounts, recurring-items and dashboard
 * specs each call the most important thing on their screen, so it is built once
 * here and the form body is passed in as a slot. Two rules it exists to enforce:
 * the form is authored **once** and mounted into whichever wrapper the
 * breakpoint calls for, and the mobile presentation is a real Sheet rather than
 * a Dialog repositioned with CSS — the two differ in focus behaviour and in how
 * they scroll, not just in where they sit.
 *
 * Both wrappers trap focus, close on Escape, and restore focus to the trigger,
 * which comes from the underlying reka-ui primitives.
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useIsDesktop } from '@/composables/useIsDesktop'

const props = defineProps<{ open: boolean; title: string; description?: string }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const isDesktop = useIsDesktop()

function setOpen(value: boolean): void {
  emit('update:open', value)
}
</script>

<template>
  <Dialog v-if="isDesktop" :open="props.open" @update:open="setOpen">
    <DialogContent class="sm:max-w-[440px]">
      <DialogHeader>
        <DialogTitle>{{ props.title }}</DialogTitle>
        <DialogDescription v-if="props.description">{{ props.description }}</DialogDescription>
        <!-- reka-ui warns when a dialog has no description; an empty one is
             worse than none, so it is omitted from the accessibility tree. -->
        <DialogDescription v-else class="sr-only">{{ props.title }}</DialogDescription>
      </DialogHeader>
      <slot />
    </DialogContent>
  </Dialog>

  <Sheet v-else :open="props.open" @update:open="setOpen">
    <!-- 88vh with internal scrolling, so a long form never pushes its own
         footer off the bottom of the screen. -->
    <SheetContent side="bottom" class="max-h-[88vh] overflow-y-auto rounded-t-xl">
      <SheetHeader>
        <SheetTitle>{{ props.title }}</SheetTitle>
        <SheetDescription v-if="props.description">{{ props.description }}</SheetDescription>
        <SheetDescription v-else class="sr-only">{{ props.title }}</SheetDescription>
      </SheetHeader>
      <div class="px-4 pb-6">
        <slot />
      </div>
    </SheetContent>
  </Sheet>
</template>
