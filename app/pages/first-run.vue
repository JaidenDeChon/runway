<script setup lang="ts">
/**
 * First-run onboarding: one account, one recurring item, then the dashboard.
 *
 * The two form objects live here, not in the step components, so a
 * Back-then-Continue round trip keeps step-1 values intact while step 2 is
 * open — the components underneath are unmount/remount on every step change,
 * this state is not. `accountId`/`itemId` track what's already been saved so
 * a repeat "Continue"/"Build my runway" after Back upserts the same record
 * instead of creating a second one.
 *
 * Every write goes through `useRunwayData`'s `saveAccount` / `saveRecurringItem`
 * — the same calls the accounts and recurring-items screens use — so
 * onboarding is a data-collection wrapper around those, not a parallel path
 * that creates records some other way.
 */
import { computed, nextTick, reactive, ref, watch } from 'vue'
import AppPage from '@/components/AppPage.vue'
import AccountStepCard from '@/components/first-run/AccountStepCard.vue'
import ChartPlaceholder from '@/components/first-run/ChartPlaceholder.vue'
import DoneCard from '@/components/first-run/DoneCard.vue'
import RecurringItemStepCard from '@/components/first-run/RecurringItemStepCard.vue'
import StepProgressDots from '@/components/first-run/StepProgressDots.vue'
import { Card } from '@/components/ui/card'
import { useRunwayData } from '@/composables/useRunwayData'
import { useToday } from '@/composables/useToday'
import { formatMoney, MINUS } from '@/lib/format'
import { nextAccountColor } from '~~/domain/accounts'
import type { Cadence, RecurringKind } from '~~/domain/types'

definePageMeta({ layout: 'onboarding' })
useHead({ title: 'Welcome - Runway' })

const { accounts, saveAccount, saveRecurringItem, clearRecords } = useRunwayData()
const today = useToday()

// Drops any stale session-local transfers left over from a previous visit
// — see `useRunwayData.clearRecords`. Recurring items are real rows now
// (issue #8) and this no longer touches them: a returning user's items are
// their real data, not seeded state to reset, and `itemId` below already
// makes the recurring-item step idempotent (a repeat "Continue" upserts the
// same row instead of creating a second one) without needing a blank slate
// here. Never deletes a database account either, for the same reason.
clearRecords()

type Step = 'account' | 'item' | 'done'
const step = ref<Step>('account')

const accountId = ref<string | null>(null)
const itemId = ref<string | null>(null)
const savingAccount = ref(false)
const accountError = ref<string | null>(null)
const savingItem = ref(false)
const itemError = ref<string | null>(null)

const accountForm = reactive({
  name: '',
  balance: 0,
  balanceAsOf: today.value,
  color: nextAccountColor(accounts.value),
})

const itemForm = reactive({
  name: '',
  kind: 'bill' as RecurringKind,
  amount: 0,
  cadence: 'monthly' as Cadence,
  nextOccurrence: today.value,
})

async function handleAccountContinue(): Promise<void> {
  const trimmed = accountForm.name.trim()
  if (!trimmed) return // the disabled button already guards this; belt and suspenders
  savingAccount.value = true
  accountError.value = null
  try {
    const saved = await saveAccount({
      id: accountId.value ?? undefined,
      name: trimmed,
      balance: accountForm.balance,
      balanceAsOf: accountForm.balanceAsOf,
      color: accountForm.color,
      // The only account onboarding ever creates, so it has to be the one
      // discretionary spend drains from — see AccountEditor's identical rule.
      isDiscretionarySource: true,
    })
    accountId.value = saved.id
    step.value = 'item'
  } catch {
    accountError.value = 'Could not save your account. Check your connection and try again.'
  } finally {
    savingAccount.value = false
  }
}

function handleBack(): void {
  step.value = 'account'
}

async function handleBuildRunway(): Promise<void> {
  const trimmed = itemForm.name.trim()
  // The disabled button already guards this (RecurringItemStepCard's own
  // isValid), including the amount: recurring_rules.amount_cents > 0 rejects
  // the step's $0 default, so belt and suspenders here matches the account
  // step's own guard above.
  if (!trimmed || !accountId.value || itemForm.amount <= 0) return
  savingItem.value = true
  itemError.value = null
  try {
    const saved = await saveRecurringItem(
      {
        ...(itemId.value ? { id: itemId.value } : {}),
        name: trimmed,
        kind: itemForm.kind,
        amount: itemForm.amount,
        cadence: itemForm.cadence,
        accountId: accountId.value,
        nextOccurrence: itemForm.nextOccurrence,
        amountSource: 'fixed',
        depositHistory: [],
        isVariable: false,
      },
      today.value,
    )
    itemId.value = saved.id
    step.value = 'done'
  } catch {
    itemError.value = 'Could not save this item. Check your connection and try again.'
  } finally {
    savingItem.value = false
  }
}

const doneSummary = computed(() => {
  const accountName = accountForm.name.trim() || 'your account'
  const itemName = itemForm.name.trim() || 'your item'
  const sign = itemForm.kind === 'income' ? '+' : MINUS
  const amount = formatMoney(itemForm.amount)
  return `We'll track ${accountName} against ${itemName} (${sign}${amount}) starting now.`
})

// Hero + chart placeholder are step-1-only, per the layout section.
const showHero = computed(() => step.value === 'account')

const panelLabel = computed(() => {
  if (step.value === 'account') return 'Step 1 of 2: Add your first account'
  if (step.value === 'item') return 'Step 2 of 2: Add a bill or paycheck'
  return "You're set."
})

// The dots are aria-hidden, so the step is announced by moving focus to this
// labelled panel instead — a static export has no equivalent to demonstrate.
const panelRef = ref<HTMLElement | null>(null)
watch(step, async () => {
  await nextTick()
  panelRef.value?.focus()
})
</script>

<template>
  <AppPage
    :title="showHero ? 'See how far your money goes.' : undefined"
    :subtitle="showHero ? 'Add one account and one bill or paycheck, and Runway builds your first projection.' : undefined"
    width="narrow"
    center-title
  >
    <ChartPlaceholder v-if="showHero" />

    <StepProgressDots :current="step === 'account' ? 1 : 2" :total="2" :done="step === 'done'" />

    <div ref="panelRef" :aria-label="panelLabel" tabindex="-1" class="outline-none">
      <Card>
        <AccountStepCard
          v-if="step === 'account'"
          v-model:name="accountForm.name"
          v-model:balance="accountForm.balance"
          v-model:balance-as-of="accountForm.balanceAsOf"
          v-model:color="accountForm.color"
          :saving="savingAccount"
          :error="accountError"
          @continue="handleAccountContinue"
        />
        <RecurringItemStepCard
          v-else-if="step === 'item'"
          v-model:name="itemForm.name"
          v-model:kind="itemForm.kind"
          v-model:amount="itemForm.amount"
          v-model:cadence="itemForm.cadence"
          v-model:next-occurrence="itemForm.nextOccurrence"
          :saving="savingItem"
          :error="itemError"
          @back="handleBack"
          @build="handleBuildRunway"
        />
        <DoneCard v-else :summary="doneSummary" />
      </Card>
    </div>
  </AppPage>
</template>
