<script setup lang="ts">
/**
 * The account form — one body, mounted into a Sheet or a Dialog by
 * `ResponsiveEditor`.
 *
 * Two deviations from the export, both deliberate:
 *
 * - **Save is disabled while the name is blank.** The export's save handler
 *   silently no-ops instead, which reads as a broken button.
 * - **Delete asks first, and says what else goes.** The export deletes
 *   immediately and leaves recurring items pointing at an account that no
 *   longer exists; `domain/accounts.ts` removes the dependents, so the user is
 *   told how many before confirming rather than after.
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
import { countDependents, nextAccountColor } from '~~/domain/accounts'
import type { Account, AccountColor } from '~~/domain/types'

const props = defineProps<{ open: boolean; account: Account | null }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const { accounts, recurringItems, transfers, saveAccount, removeAccount } = useRunwayData()
const today = useToday()

const isEditing = computed(() => props.account !== null)
const confirmingDelete = ref(false)

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
    confirmingDelete.value = false
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

const dependents = computed(() =>
  props.account
    ? countDependents(recurringItems.value, transfers.value, props.account.id)
    : { items: 0, transfers: 0 },
)

const deleteWarning = computed(() => {
  const { items, transfers: moves } = dependents.value
  if (items === 0 && moves === 0) return 'This account will be removed.'
  const parts: string[] = []
  if (items > 0) parts.push(`${items} recurring item${items === 1 ? '' : 's'}`)
  if (moves > 0) parts.push(`${moves} transfer${moves === 1 ? '' : 's'}`)
  return `This also deletes ${parts.join(' and ')}.`
})

function onSave(): void {
  if (!isValid.value) return
  saveAccount({
    ...(props.account ? { id: props.account.id } : {}),
    name: form.name.trim(),
    balance: form.balance,
    balanceAsOf: form.balanceAsOf,
    color: form.color,
    isDiscretionarySource: form.isDiscretionarySource,
  })
  emit('update:open', false)
}

function onDelete(): void {
  if (!props.account) return
  removeAccount(props.account.id)
  emit('update:open', false)
}
</script>

<template>
  <ResponsiveEditor
    :open="props.open"
    :title="isEditing ? 'Edit account' : 'Add account'"
    @update:open="(value) => emit('update:open', value)"
  >
    <form class="flex flex-col gap-4" @submit.prevent="onSave">
      <div class="flex flex-col gap-2">
        <Label for="account-name">Name</Label>
        <Input id="account-name" v-model="form.name" placeholder="e.g. Checking" autocomplete="off" />
      </div>

      <div class="flex flex-col gap-2">
        <Label>Line color</Label>
        <AccountColorPicker v-model="form.color" name="account-color" />
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="flex flex-col gap-2">
          <Label for="account-balance">Balance</Label>
          <MoneyInput id="account-balance" v-model="form.balance" aria-label="Balance" />
        </div>
        <div class="flex flex-col gap-2">
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

      <div v-if="confirmingDelete" role="alertdialog" class="rounded-md border border-destructive/30 bg-destructive/10 p-3">
        <p class="text-sm font-medium">Delete {{ props.account?.name }}?</p>
        <p class="mt-1 text-xs text-muted-foreground">{{ deleteWarning }}</p>
        <div class="mt-3 flex gap-2">
          <Button type="button" variant="destructive" size="sm" @click="onDelete">Delete</Button>
          <Button type="button" variant="ghost" size="sm" @click="confirmingDelete = false">
            Keep it
          </Button>
        </div>
      </div>

      <div class="flex items-center justify-between gap-2 pt-1">
        <Button
          v-if="isEditing"
          type="button"
          variant="ghost"
          class="text-destructive hover:text-destructive"
          @click="confirmingDelete = true"
        >
          Delete
        </Button>
        <span v-else />

        <div class="flex gap-2">
          <Button type="button" variant="outline" @click="emit('update:open', false)">Cancel</Button>
          <Button type="submit" :disabled="!isValid">
            {{ isEditing ? 'Save changes' : 'Add account' }}
          </Button>
        </div>
      </div>
    </form>
  </ResponsiveEditor>
</template>
