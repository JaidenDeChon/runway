<script setup lang="ts">
/**
 * The "Estimates" card on `/accounts` — how many recent settled amounts an
 * estimate averages (`user_settings.prediction_window`, issue #18).
 *
 * **There is no `docs/design/` artifact for this surface**, the same position
 * `DiscretionarySpendCard` records for itself. It sits with the other two
 * household settings cards because it is the same kind of thing: one number
 * that changes every forecast, stated once. Built from this repo's own
 * pieces — `Card`, `Select`, `Label`, `Button`, tokens only — and the same
 * explicit-Save idiom as its siblings, so nothing is written until asked.
 *
 * A `Select`, not a slider or a segmented control: eleven whole values
 * (`MIN_PREDICTION_WINDOW`..`MAX_PREDICTION_WINDOW`) are too many segments
 * for 375px, and a slider is a poor way to hit an exact small integer with a
 * thumb. The trade-off the number controls — smoothing against reacting — is
 * said in the description, because it is the one thing nobody can guess from
 * the control alone, and it is the known failure mode `domain/prediction.ts`
 * documents.
 *
 * No props, no emits, no arithmetic: every piece of state is in the seam.
 */
import { computed, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useRunwayData } from '@/composables/useRunwayData'
import { MAX_PREDICTION_WINDOW, MIN_PREDICTION_WINDOW } from '~~/domain/prediction'

const { predictionWindow, setPredictionWindow } = useRunwayData()

const OPTIONS = Array.from(
  { length: MAX_PREDICTION_WINDOW - MIN_PREDICTION_WINDOW + 1 },
  (_, index) => MIN_PREDICTION_WINDOW + index,
)

const draft = ref<number>(predictionWindow.value)
const saving = ref(false)
const errorMessage = ref<string | null>(null)
const justSaved = ref(false)

// Resync from the seam unless a save is in flight — the same guard, and the
// same reason, as `DiscretionarySpendCard`'s watch.
watch(predictionWindow, (next) => {
  if (saving.value) return
  draft.value = next
  justSaved.value = false
})

watch(draft, () => {
  justSaved.value = false
})

const isDirty = computed(() => draft.value !== predictionWindow.value)

function onSelect(value: unknown): void {
  const next = Number(value)
  if (Number.isInteger(next)) draft.value = next
}

async function onSave(): Promise<void> {
  if (!isDirty.value || saving.value) return
  saving.value = true
  errorMessage.value = null
  try {
    await setPredictionWindow(draft.value)
    justSaved.value = true
  } catch {
    errorMessage.value = 'Could not save that setting. Check your connection and try again.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Card>
    <form class="flex flex-col gap-4" @submit.prevent="onSave">
      <CardHeader class="gap-1">
        <CardTitle>Estimates</CardTitle>
        <CardDescription>
          Predicted paychecks and bills that vary are estimated from what actually landed, once
          you've marked at least {{ MIN_PREDICTION_WINDOW }} of them paid or received.
        </CardDescription>
      </CardHeader>

      <CardContent class="flex flex-col gap-3">
        <div class="flex flex-wrap items-end gap-3">
          <div class="flex min-w-0 flex-1 flex-col gap-2">
            <Label for="prediction-window">Average the last</Label>
            <Select :model-value="String(draft)" @update:model-value="onSelect">
              <SelectTrigger id="prediction-window" class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="option in OPTIONS" :key="option" :value="String(option)">
                  {{ option }} amounts
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button id="prediction-window-save" type="submit" :disabled="!isDirty || saving">
            Save
          </Button>
        </div>

        <p class="text-xs text-muted-foreground">
          More smooths out a one-off, like a bonus or a winter heating bill. Fewer catches a real
          change, like a raise, sooner.
        </p>

        <p v-if="justSaved" role="status" class="text-xs text-muted-foreground">Saved.</p>
        <p v-if="errorMessage" role="alert" class="text-sm text-destructive">{{ errorMessage }}</p>
      </CardContent>
    </form>
  </Card>
</template>
