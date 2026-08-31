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

watch(
  () => [props.open, props.account] as const,
  ([open, account]) => {
    if (!open) return
    confirmingArchive.value = false
    errorMessage.value = null
    if (account) {
      Object.assign(form, {
        name: account.name,
        balance: account.balance,
        balanceAsOf: account.balanceAsOf,
        color: account.color,
        isDiscretionarySource: account.isDiscretionarySource,
      })
      return
    }
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
      balanceAsOf: form.balanceAsOf,
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
            <Input id="account-as-of" v-model="form.balanceAsOf" type="date" class="font-mono" />
          </div>
        </div>

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
