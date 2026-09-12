<script setup lang="ts">
/**
 * The account form — one body, mounted into a Sheet or a Dialog by
 * `ResponsiveEditor`.
 *
 * Three modes, one component:
 * - **Add** (`account` is `null`): a blank form, defaulted per the watcher below.
 * - **Edit** (`account` is active): the form, plus a footer-left `Archive`
 *   button. Archiving is reversible, so it is `variant="ghost"`, not
 *   destructive-red — a deviation from `edit-sheet.png`, noted in the PR.
 * - **Archived** (`account.archivedOn` is set): every field `inert`, a muted
 *   note instead of the balance-as-of line, and the footer becomes
 *   Restore + Close.
 *
 * Every write is async and can fail — a dropped connection, an expired
 * session — so `saving` disables the buttons and a failure renders inline
 * rather than closing the editor out from under whatever the user typed.
 */
import { computed, reactive, ref, watch } from 'vue'
import AccountColorPicker from '@/components/AccountColorPicker.vue'
import MoneyInput from '@/components/MoneyInput.vue'
import ResponsiveEditor from '@/components/ResponsiveEditor.vue'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useRunwayData } from '@/composables/useRunwayData'
import { useToday } from '@/composables/useToday'
import { formatDateLong } from '@/lib/format'
import { accountsUsingColor, nextAccountColor } from '~~/domain/accounts'
import type { Account, AccountColor } from '~~/domain/types'

const props = defineProps<{ open: boolean; account: Account | null }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const { accounts, saveAccount, archiveAccount, restoreAccount } = useRunwayData()
const today = useToday()

const isEditing = computed(() => props.account !== null)
const isArchived = computed(() => props.account?.archivedOn !== undefined)
const confirmingArchive = ref(false)
const saving = ref(false)
const errorMessage = ref<string | null>(null)

const form = reactive({
  name: '',
  balance: 0,
  balanceAsOf: today.value,
  color: 'chart-2' as AccountColor,
  isDiscretionarySource: false,
})

// The balance the field was seeded with, so `onSave` can tell "left the
// figure alone" apart from "typed a new one" — the same idiom
// `RecurringItemEditor`'s `seededNextOccurrence` uses for its date field.
const seededBalance = ref(0)

/**
 * Whether the user has interacted with "As of" this time the editor is open.
 *
 * Comparing the field's current value against the account's stored day is not
 * enough on its own: it cannot tell "left it alone" apart from "deliberately
 * re-affirmed the same day", and the second of those is exactly what
 * correcting *today's* stored reading looks like — the field is seeded with
 * that same day, so retyping it changes nothing for a value comparison to
 * see. Tracking real interaction, not just the resulting value, is what makes
 * both cases reachable.
 */
const asOfTouched = ref(false)

watch(
  () => [props.open, props.account] as const,
  ([open, account]) => {
    if (!open) return
    confirmingArchive.value = false
    errorMessage.value = null
    asOfTouched.value = false
    if (account) {
      seededBalance.value = account.balance
      Object.assign(form, {
        name: account.name,
        balance: account.balance,
        balanceAsOf: account.balanceAsOf,
        color: account.color,
        isDiscretionarySource: account.isDiscretionarySource,
      })
      return
    }
    seededBalance.value = 0
    Object.assign(form, {
      name: '',
      balance: 0,
      balanceAsOf: today.value,
      color: nextAccountColor(accounts.value),
      // The first account has to be the discretionary source — with no other
      // account, the daily spend would otherwise have nothing to drain.
      isDiscretionarySource: accounts.value.length === 0,
    })
  },
  { immediate: true },
)

/**
 * What "As of" to actually save.
 *
 * Editing the balance without touching "As of" must not silently redate the
 * account's *current* reading to whatever day it already carried — a day can
 * hold only one true balance, so saving the typed figure against the old date
 * would redefine what the account held back then rather than record what it
 * holds now, and the correction would never even reach
 * `docs/database/schema.md`'s `balance_readings` history: nothing else moved
 * for that day to be superseded from. So a changed balance whose date field
 * was never touched saves against today instead. Touching "As of" at all —
 * even retyping the day already shown — always wins; correcting a specific
 * past (or current) reading is still what the field is for, and is exactly
 * what that retype looks like.
 */
const balanceAsOfToSave = computed(() => {
  if (!props.account || asOfTouched.value) return form.balanceAsOf
  const balanceChanged = form.balance !== seededBalance.value
  return balanceChanged ? today.value : form.balanceAsOf
})

/**
 * Surfaces the substitution above rather than letting it happen silently
 * behind a date field that still reads the old day — a visible, editable
 * control whose value is quietly overridden is a trap, not a convenience.
 */
const balanceAsOfHint = computed(() => {
  if (balanceAsOfToSave.value === form.balanceAsOf) return null
  return `Saved as of ${formatDateLong(balanceAsOfToSave.value)}. To record it for ${formatDateLong(form.balanceAsOf)} instead, edit the "As of" field.`
})

const isValid = computed(() => form.name.trim().length > 0)

/** Warn, never prevent: only three slots are assignable, so a fourth account guarantees a collision. */
const collisionNames = computed(() =>
  accountsUsingColor(accounts.value, form.color, props.account?.id).map((account) => account.name),
)

const collisionHint = computed(() => {
  const names = collisionNames.value
  if (names.length === 0) return null
  if (names.length === 1) return `${names[0]} already uses this colour.`
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)} already use this colour.`
})

const title = computed(() => {
  if (isArchived.value) return 'Archived account'
  return isEditing.value ? 'Edit account' : 'Add account'
})

async function onSave(): Promise<void> {
  if (!isValid.value || isArchived.value) return
  saving.value = true
  errorMessage.value = null
  try {
    await saveAccount({
      ...(props.account ? { id: props.account.id } : {}),
      name: form.name.trim(),
      balance: form.balance,
      balanceAsOf: balanceAsOfToSave.value,
      color: form.color,
      isDiscretionarySource: form.isDiscretionarySource,
    })
    emit('update:open', false)
  } catch {
    errorMessage.value = 'Could not save this account. Check your connection and try again.'
  } finally {
    saving.value = false
  }
}

async function onArchive(): Promise<void> {
  if (!props.account) return
  saving.value = true
  errorMessage.value = null
  try {
    await archiveAccount(props.account.id, today.value)
    emit('update:open', false)
  } catch {
    errorMessage.value = 'Could not archive this account. Check your connection and try again.'
  } finally {
    saving.value = false
  }
}

async function onRestore(): Promise<void> {
  if (!props.account) return
  saving.value = true
  errorMessage.value = null
  try {
    await restoreAccount(props.account.id)
    emit('update:open', false)
  } catch {
    errorMessage.value = 'Could not restore this account. Check your connection and try again.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <ResponsiveEditor :open="props.open" :title="title" @update:open="(value) => emit('update:open', value)">
    <form class="flex flex-col gap-4" @submit.prevent="onSave">
      <div :inert="isArchived" class="flex flex-col gap-4">
        <div class="flex flex-col gap-2">
          <Label for="account-name">Name</Label>
          <Input
            id="account-name"
            v-model="form.name"
            placeholder="e.g. Checking"
            autocomplete="off"
          />
        </div>

        <div class="flex flex-col gap-2">
          <Label>Line color</Label>
          <AccountColorPicker v-model="form.color" name="account-color" />
          <p v-if="collisionHint" class="text-xs text-muted-foreground">{{ collisionHint }}</p>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="flex min-w-0 flex-col gap-2">
            <Label for="account-balance">Balance</Label>
            <MoneyInput id="account-balance" v-model="form.balance" allow-negative aria-label="Balance" />
          </div>
          <div class="flex min-w-0 flex-col gap-2">
            <Label for="account-as-of">As of</Label>
            <Input
              id="account-as-of"
              v-model="form.balanceAsOf"
              type="date"
              class="font-mono"
              @input="asOfTouched = true"
            />
          </div>
        </div>

        <p v-if="balanceAsOfHint" class="text-xs text-muted-foreground">{{ balanceAsOfHint }}</p>

        <div class="flex items-start gap-3">
          <Checkbox
            id="account-discretionary"
            :model-value="form.isDiscretionarySource"
            aria-describedby="account-discretionary-help"
            @update:model-value="(value) => (form.isDiscretionarySource = value === true)"
          />
          <div class="grid gap-1">
            <Label for="account-discretionary" class="leading-snug">
              Draw discretionary spend from this account
            </Label>
            <p id="account-discretionary-help" class="text-xs text-muted-foreground">
              The account your daily spending figure drains. Only one account can hold this.
            </p>
          </div>
        </div>
      </div>

      <p v-if="isArchived" class="text-xs text-muted-foreground">
        Archived {{ formatDateLong(props.account!.archivedOn!) }}. It is not part of your forecast.
      </p>

      <p v-if="errorMessage" role="alert" class="text-sm text-destructive">{{ errorMessage }}</p>

      <div
        v-if="confirmingArchive"
        role="alertdialog"
        class="rounded-md border border-chart-warning/40 bg-chart-warning/8 p-3"
      >
        <p class="text-sm font-medium">Archive {{ props.account?.name }}?</p>
        <p class="mt-1 text-xs text-muted-foreground">
          It stops feeding your forecast and drops out of the list. Nothing is deleted — you can
          restore it whenever you like.
        </p>
        <p v-if="props.account?.isDiscretionarySource" class="mt-1 text-xs text-muted-foreground">
          Discretionary spend will have nowhere to draw from until you pick another account.
        </p>
        <div class="mt-3 flex gap-2">
          <Button type="button" variant="default" size="sm" :disabled="saving" @click="onArchive">
            Archive
          </Button>
          <Button type="button" variant="ghost" size="sm" @click="confirmingArchive = false">
            Keep it
          </Button>
        </div>
      </div>

      <div class="flex items-center justify-between gap-2 pt-1">
        <template v-if="isArchived">
          <span />
          <div class="flex gap-2">
            <Button type="button" variant="ghost" @click="emit('update:open', false)">Close</Button>
            <Button type="button" :disabled="saving" @click="onRestore">Restore</Button>
          </div>
        </template>
        <template v-else>
          <Button
            v-if="isEditing"
            type="button"
            variant="ghost"
            :disabled="saving"
            @click="confirmingArchive = true"
          >
            Archive
          </Button>
          <span v-else />

          <div class="flex gap-2">
            <Button type="button" variant="outline" @click="emit('update:open', false)">Cancel</Button>
            <Button type="submit" :disabled="!isValid || saving">
              {{ isEditing ? 'Save changes' : 'Add account' }}
            </Button>
          </div>
        </template>
      </div>
    </form>
  </ResponsiveEditor>
</template>
