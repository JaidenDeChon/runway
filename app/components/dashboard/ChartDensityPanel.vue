<script setup lang="ts">
/**
 * The ⚙ panel: three live sliders that change how the chart is drawn.
 *
 * Presentation only — nothing here touches the projection. The parent owns the
 * value and its persistence; this component just edits it. Slider ranges come
 * from `DENSITY_BOUNDS` so they cannot drift from the bounds a restored value is
 * screened against. The values echo beside their labels because that is the only place
 * they are readable; see the note in the parent about the slider thumb's
 * accessible name, which this component cannot reach.
 */
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import type { ChartDensity } from '@/lib/burndown'
import { DENSITY_BOUNDS } from '@/lib/burndown'

const props = defineProps<{ density: ChartDensity }>()
const emit = defineEmits<{ 'update:density': [value: ChartDensity] }>()

/** reka's Slider is multi-thumb, so it models its value as an array of one. */
function update(key: keyof ChartDensity, value: number[] | undefined): void {
  const next = value?.[0]
  if (next === undefined) return
  emit('update:density', { ...props.density, [key]: next })
}
</script>

<template>
  <!-- No card chrome: the dialog is the surface now, and a filled card inside
       one reads as a second, nested panel. -->
  <div class="flex flex-col gap-4" role="group" aria-label="Chart density">
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <Label for="density-line-weight">Line weight</Label>
          <span class="font-mono text-xs tabular-nums">{{ props.density.lineWeight }}</span>
        </div>
        <Slider
          thumb-id="density-line-weight"
          :model-value="[props.density.lineWeight]"
          :min="DENSITY_BOUNDS.lineWeight.min"
          :max="DENSITY_BOUNDS.lineWeight.max"
          :step="DENSITY_BOUNDS.lineWeight.step"
          thumb-label="Line weight"
          @update:model-value="(value) => update('lineWeight', value)"
        />
      </div>

      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <Label for="density-dash">Dash density</Label>
          <span class="font-mono text-xs tabular-nums">{{ props.density.dashDensity }}</span>
        </div>
        <Slider
          thumb-id="density-dash"
          :model-value="[props.density.dashDensity]"
          :min="DENSITY_BOUNDS.dashDensity.min"
          :max="DENSITY_BOUNDS.dashDensity.max"
          :step="DENSITY_BOUNDS.dashDensity.step"
          thumb-label="Dash density"
          @update:model-value="(value) => update('dashDensity', value)"
        />
      </div>

      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <Label for="density-marker">Marker size</Label>
          <span class="font-mono text-xs tabular-nums">
            {{ props.density.markerSize.toFixed(1) }}
          </span>
        </div>
        <Slider
          thumb-id="density-marker"
          :model-value="[props.density.markerSize]"
          :min="DENSITY_BOUNDS.markerSize.min"
          :max="DENSITY_BOUNDS.markerSize.max"
          :step="DENSITY_BOUNDS.markerSize.step"
          thumb-label="Marker size"
          :thumb-value-text="props.density.markerSize.toFixed(1)"
          @update:model-value="(value) => update('markerSize', value)"
        />
    </div>
  </div>
</template>
