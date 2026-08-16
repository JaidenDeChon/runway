<script setup lang="ts">
import type { SliderRootEmits, SliderRootProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { SliderRange, SliderRoot, SliderThumb, SliderTrack, useForwardPropsEmits } from 'reka-ui'
import { cn } from '@/lib/utils'

/**
 * Registry component, with one addition: the thumb can be labelled.
 *
 * reka-ui puts `role="slider"` on the *thumb*, so an `aria-label` on the root
 * never reaches the control a screen reader actually focuses — it announces as
 * "Value" with a bare `aria-valuenow`. The registry wrapper offers no way to
 * bind onto the thumb, hence these three props. Re-running `shadcn-vue add
 * slider` overwrites this file and silently reintroduces the bug.
 */
const props = defineProps<
  SliderRootProps & {
    class?: HTMLAttributes['class']
    /** Spoken name for the thumb. */
    thumbLabel?: string
    /** Spoken value, when the raw number is not self-describing (e.g. "8 pixels"). */
    thumbValueText?: string
    /** Lands on the thumb, so a `<Label for>` associates with the focusable element. */
    thumbId?: string
  }
>()
const emits = defineEmits<SliderRootEmits>()

const delegatedProps = reactiveOmit(props, 'class', 'thumbLabel', 'thumbValueText', 'thumbId')

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <SliderRoot
    v-slot="{ modelValue }"
    data-slot="slider"
    :data-vertical="props.orientation === 'vertical' ? '' : undefined"
    :class="cn(
      'data-vertical:min-h-40 relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:w-auto data-vertical:flex-col',
      props.class,
    )"
    v-bind="forwarded"
  >
    <SliderTrack
      data-slot="slider-track"
      :data-horizontal="props.orientation !== 'vertical' ? '' : undefined"
      :data-vertical="props.orientation === 'vertical' ? '' : undefined"
      class="bg-muted rounded-4xl data-horizontal:h-3 data-vertical:w-3 relative grow overflow-hidden data-horizontal:w-full data-vertical:h-full"
    >
      <SliderRange
        data-slot="slider-range"
        :data-horizontal="props.orientation !== 'vertical' ? '' : undefined"
        :data-vertical="props.orientation === 'vertical' ? '' : undefined"
        class="bg-primary absolute select-none data-horizontal:h-full data-vertical:w-full"
      />
    </SliderTrack>

    <SliderThumb
      v-for="(_, key) in modelValue"
      :key="key"
      :id="key === 0 ? props.thumbId : undefined"
      data-slot="slider-thumb"
      :data-vertical="props.orientation === 'vertical' ? '' : undefined"
      :aria-label="props.thumbLabel"
      :aria-valuetext="props.thumbValueText"
      class="border-primary ring-ring/50 size-4 rounded-4xl border bg-background shadow-sm transition-colors hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden block shrink-0 select-none disabled:pointer-events-none disabled:opacity-50"
    />
  </SliderRoot>
</template>
