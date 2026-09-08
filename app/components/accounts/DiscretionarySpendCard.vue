<script setup lang="ts">
/**
 * The "Everyday spending" card on `/accounts` — where a user states how much a
 * typical month costs on things that are not bills.
 *
 * **There is no `docs/design/` artifact for this surface.** `docs/design/`
 * covers `accounts`, `dashboard`, `first-run`, `recurring-items` and
 * `shortfall` only. `docs/design/dashboard/spec.md:481-482` records the
 * arithmetic half as resolved by issue #4 and leaves open whether the drain
 * is *visible* on the dashboard and *adjustable* from there; this card answers
 * the "adjustable from where" half on `/accounts`, directly under the account
 * rows that carry the "Discretionary source" badge — the account half of the
 * same sentence. It is built from this repo's own conventions (`Card`,
 * `MoneyInput`, `Label`, `Button`, tokens only), exactly as `app/layouts/auth.vue`
 * records for the auth screens.
 *
 * No props, no emits: every piece of state it needs is already in the seam,
 * and it calls `useRunwayData()` itself the way `AccountEditor.vue` does. It
 * performs no arithmetic on money — it holds one integer and hands it to
 * `setMonthlyDiscretionarySpend`.
 */
import { computed, ref, watch } from 'vue'
import MoneyInput from '@/components/MoneyInput.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { useRunwayData } from '@/composables/useRunwayData'
import type { MinorUnits } from '~~/domain/money'

const { accounts, monthlyDiscretionarySpend, setMonthlyDiscretionarySpend } = useRunwayData()

const draft = ref<MinorUnits>(monthlyDiscretionarySpend.value)
const saving = ref(false)
const errorMessage = ref<string | null>(null)
const justSaved = ref(false)

// Resync if the household reloads underneath (a `refresh()` elsewhere, a
// sign-in), and drop the confirmation once the stored value has moved on.
watch(monthlyDiscretionarySpend, (next) => {
  draft.value = next
  justSaved.value = false
})

// "Saved." is only true for the value that was actually saved; any further
// edit clears it.
watch(draft, () => {
  justSaved.value = false
})

const isDirty = computed(() => draft.value !== monthlyDiscretionarySpend.value)

const sourceAccount = computed(() => accounts.value.find((a) => a.isDiscretionarySource) ?? null)

async function onSave(): Promise<void> {
  if (!isDirty.value || saving.value) return
  saving.value = true
  errorMessage.value = null
  try {
    await setMonthlyDiscretionarySpend(draft.value)
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
        <CardTitle>Everyday spending</CardTitle>
        <CardDescription>
          Groceries, gas, coffee — everyday spending that isn't a bill. Runway spreads it evenly
          across each month and takes it out day by day.
        </CardDescription>
      </CardHeader>

      <CardContent class="flex flex-col gap-3">
        <div class="flex flex-wrap items-end gap-3">
          <div class="flex min-w-0 flex-1 flex-col gap-2">
            <Label for="discretionary-monthly">Monthly amount</Label>
            <MoneyInput
              id="discretionary-monthly"
              v-model="draft"
              aria-label="Monthly everyday spending"
            />
          </div>
          <Button id="discretionary-save" type="submit" :disabled="!isDirty || saving">Save</Button>
        </div>

        <p v-if="sourceAccount" class="text-xs text-muted-foreground">
          Drawn from {{ sourceAccount.name }}.
        </p>
        <p v-else class="text-xs text-muted-foreground">
          No account is drawing this yet. Open an account above and tick "Draw discretionary spend
          from this account".
        </p>

        <p class="text-xs text-muted-foreground">Set it to $0 to leave it out of your forecast.</p>

        <p v-if="justSaved" role="status" class="text-xs text-muted-foreground">Saved.</p>
        <p v-if="errorMessage" role="alert" class="text-sm text-destructive">{{ errorMessage }}</p>
      </CardContent>
    </form>
  </Card>
</template>
