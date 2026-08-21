<script setup lang="ts">
import { Landmark, Plus } from '@lucide/vue'
import AppPage from '@/components/AppPage.vue'
import AccountEditor from '@/components/accounts/AccountEditor.vue'
import AccountRow from '@/components/accounts/AccountRow.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useRunwayData } from '@/composables/useRunwayData'
import { balanceReadings } from '~~/domain/accounts'
import type { Account } from '~~/domain/types'

useHead({ title: 'Accounts - Runway' })

const { accounts } = useRunwayData()

// Which readings are out of step is the domain's call, not the list's. The
// dashboard asks the same question of the same function; this screen is where
// the answer is actionable, since it is where balances are edited.
const daysBehindByAccount = computed(
  () =>
    new Map(
      balanceReadings(accounts.value).stale.map((entry) => [entry.accountId, entry.daysBehind]),
    ),
)

const editorOpen = ref(false)
const editing = ref<Account | null>(null)

function openEdit(account: Account): void {
  editing.value = account
  editorOpen.value = true
}

function openAdd(): void {
  editing.value = null
  editorOpen.value = true
}
</script>

<template>
  <AppPage title="Accounts" subtitle="These balances feed your runway. Keep them current.">
    <template #actions>
      <!-- Desktop placement of the same action the dashed in-card button
           offers on mobile; only ever one of the two is visible. -->
      <Button class="hidden lg:inline-flex" @click="openAdd">
        <Plus aria-hidden="true" class="size-4" />
        Add account
      </Button>
    </template>

    <Card class="gap-0 overflow-hidden py-0">
      <p v-if="accounts.length === 0" class="px-4 py-6 text-sm text-muted-foreground">
        No accounts yet. Add the account you spend from to see your first projection.
      </p>

      <template v-else>
        <div
          v-for="(account, index) in accounts"
          :key="account.id"
          :class="index > 0 ? 'border-t' : ''"
        >
          <AccountRow
            :account="account"
            :days-behind="daysBehindByAccount.get(account.id) ?? 0"
            @select="openEdit(account)"
          />
        </div>
      </template>

      <div class="border-t p-3 lg:hidden">
        <Button variant="outline" class="w-full border-dashed text-primary" @click="openAdd">
          <Plus aria-hidden="true" class="size-4" />
          Add account
        </Button>
      </div>
    </Card>

    <!-- Inert by design: not focusable, not clickable, and kept out of the
         tab order entirely rather than merely dimmed. -->
    <Card aria-disabled="true" class="cursor-not-allowed opacity-60">
      <div class="flex items-start gap-3 px-4">
        <span class="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent">
          <Landmark aria-hidden="true" class="size-4 text-muted-foreground" />
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-medium">Connect a bank</span>
            <Badge variant="secondary">Coming soon</Badge>
          </div>
          <p class="mt-1 text-sm text-muted-foreground">
            Sync balances automatically instead of updating them by hand.
          </p>
        </div>
      </div>
    </Card>

    <AccountEditor v-model:open="editorOpen" :account="editing" />
  </AppPage>
</template>
