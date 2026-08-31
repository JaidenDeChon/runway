<script setup lang="ts">
import { Landmark, Plus } from '@lucide/vue'
import AppPage from '@/components/AppPage.vue'
import AccountEditor from '@/components/accounts/AccountEditor.vue'
import AccountRow from '@/components/accounts/AccountRow.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useRunwayData } from '@/composables/useRunwayData'
import { useToday } from '@/composables/useToday'
import { balanceReadings, staleAnchors } from '~~/domain/accounts'
import type { Account } from '~~/domain/types'

useHead({ title: 'Accounts - Runway' })

const { accounts, archived, staleAfterDays, isLoading, loadError, refresh } = useRunwayData()
const today = useToday()

// Which readings are out of step is the domain's call, not the list's. The
// dashboard asks the same question of the same function; this screen is where
// the answer is actionable, since it is where balances are edited.
const daysBehindByAccount = computed(
  () =>
    new Map(
      balanceReadings(accounts.value).stale.map((entry) => [entry.accountId, entry.daysBehind]),
    ),
)

// Absolute anchor age against today, not the accounts' relative drift against
// each other — see the note in domain/accounts.ts. AccountRow shows at most
// one warning per row and this one wins when both apply.
const staleDaysByAccount = computed(
  () =>
    new Map(
      staleAnchors(accounts.value, today.value, staleAfterDays.value).map((entry) => [
        entry.accountId,
        entry.ageDays,
      ]),
    ),
)

// Nothing loaded yet, and no cached copy to show while it does.
const showSkeleton = computed(
  () => isLoading.value && accounts.value.length === 0 && archived.value.length === 0,
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
      <div v-if="showSkeleton" class="flex flex-col gap-3.5 p-4">
        <Skeleton v-for="n in 3" :key="n" class="h-14 w-full" />
      </div>

      <Alert v-else-if="loadError" variant="destructive" class="m-4 w-auto">
        <AlertTitle>{{ loadError }}</AlertTitle>
        <AlertDescription>
          <Button type="button" variant="outline" size="sm" class="mt-2" @click="refresh">
            Try again
          </Button>
        </AlertDescription>
      </Alert>

      <div v-else-if="accounts.length === 0" class="px-4 py-6">
        <h2 class="text-base font-medium">No accounts yet</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          Add the account you spend from — its balance is where every forecast starts.
        </p>
      </div>

      <template v-else>
        <div
          v-for="(account, index) in accounts"
          :key="account.id"
          :class="index > 0 ? 'border-t' : ''"
        >
          <AccountRow
            :account="account"
            :days-behind="daysBehindByAccount.get(account.id) ?? 0"
            :stale-days="staleDaysByAccount.get(account.id) ?? 0"
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

    <!-- Rendered only when there is at least one, so the default screen still
         matches default.png exactly. Not a filter toggle: a second card is the
         smallest thing that makes "nothing was deleted" visible. -->
    <Card v-if="archived.length > 0" class="gap-0 overflow-hidden py-0">
      <h2 class="px-4 pt-4 text-sm font-medium text-muted-foreground">Archived</h2>
      <div
        v-for="(account, index) in archived"
        :key="account.id"
        :class="index > 0 ? 'border-t' : 'mt-1'"
      >
        <AccountRow :account="account" @select="openEdit(account)" />
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
