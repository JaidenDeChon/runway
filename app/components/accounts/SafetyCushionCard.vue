<script setup lang="ts">
/**
 * The "Safety cushion" card on `/accounts` — the lowest balance the user is
 * comfortable letting their forecast reach.
 *
 * Moved here from `/will-i-make-it`, where it used to auto-save on a 400ms
 * debounce and flush a pending edit from `onBeforeUnmount` on the way out —
 * the one place in the app that tried to persist a write from a component
 * teardown hook. That combination could leave the app unable to navigate
 * away after an edit until the page was hard-reloaded, and the write racing
 * the navigation could lose, leaving the chart's danger band showing a
 * cushion the account did not actually hold. This card uses the same
 * explicit-Save idiom `DiscretionarySpendCard` (right above it) already
 * uses safely: no write is attempted until the user asks for one, so there
 * is nothing left for a navigation to race.
 *
 * The cushion is shared, not screen-local — `docs/database/schema.md`'s
 * mapping table and the dashboard's chart (`Safety cushion · {amount}`) and
 * `/will-i-make-it`'s verdict both read the same stored `safetyCushion`. This
 * card is now the only place that writes it.
 *
 * No props, no emits, matching `DiscretionarySpendCard`: every piece of
 * state it needs is already in the seam. It performs no arithmetic on
 * money — it holds one integer and hands it to `setSafetyCushion`.
 */
import { computed, ref, watch } from 'vue'
import MoneyInput from '@/components/MoneyInput.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { useRunwayData } from '@/composables/useRunwayData'
import type { MinorUnits } from '~~/domain/money'

const { safetyCushion, setSafetyCushion } = useRunwayData()

const draft = ref<MinorUnits>(safetyCushion.value)
const saving = ref(false)
const errorMessage = ref<string | null>(null)
const justSaved = ref(false)

// Resync if the household reloads underneath (a `refresh()` elsewhere, a
// sign-in), and drop the confirmation once the stored value has moved on.
//
// Skipped while a save is in flight: `setSafetyCushion` writes its optimistic
// value to this same computed *and*, on a failed write, rolls it straight
// back to the old one — both changes land before `onSave`'s `catch` even
// runs. Resyncing on the second one would silently snap the field back to
// the stored value the instant the error appeared, hiding the very thing the
// error message is reporting and destroying what the user typed. `onSave`'s
// `finally` is what clears `saving`, so the field simply keeps whatever the
// user last typed until they act on the error.
watch(safetyCushion, (next) => {
  if (saving.value) return
  draft.value = next
  justSaved.value = false
})

// "Saved." is only true for the value that was actually saved; any further
// edit clears it.
watch(draft, () => {
  justSaved.value = false
})

const isDirty = computed(() => draft.value !== safetyCushion.value)

async function onSave(): Promise<void> {
  if (!isDirty.value || saving.value) return
  saving.value = true
  errorMessage.value = null
  try {
    await setSafetyCushion(draft.value)
    justSaved.value = true
  } catch {
    errorMessage.value = 'Could not save that amount. Check your connection and try again.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Card>
    <form class="flex flex-col gap-4" @submit.prevent="onSave">
      <CardHeader class="gap-1">
        <CardTitle>Safety cushion</CardTitle>
        <CardDescription>
          The lowest balance you're comfortable letting it reach. Your dashboard chart and Will I
          Make It use this same figure.
        </CardDescription>
      </CardHeader>

      <CardContent class="flex flex-col gap-3">
        <div class="flex flex-wrap items-end gap-3">
          <div class="flex min-w-0 flex-1 flex-col gap-2">
            <Label for="account-cushion">Cushion amount</Label>
            <MoneyInput id="account-cushion" v-model="draft" aria-label="Safety cushion" />
          </div>
          <Button id="cushion-save" type="submit" :disabled="!isDirty || saving">Save</Button>
        </div>

        <p v-if="justSaved" role="status" class="text-xs text-muted-foreground">Saved.</p>
        <p v-if="errorMessage" role="alert" class="text-sm text-destructive">{{ errorMessage }}</p>
      </CardContent>
    </form>
  </Card>
</template>
