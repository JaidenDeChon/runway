<script setup lang="ts">
import { computed } from 'vue'
import AppPage from '@/components/AppPage.vue'
import TransferForm from '@/components/transfers/TransferForm.vue'
import TransferRow from '@/components/transfers/TransferRow.vue'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { useRunwayData } from '@/composables/useRunwayData'
import { sortTransfers } from '~~/domain/transfers'

useHead({ title: 'Transfers - Runway' })

const { transfers, accountsById } = useRunwayData()

// A real sort on date, not the prepend order records arrive in — a
// back-dated transfer has to land by its date, not by entry order.
const sortedTransfers = computed(() => sortTransfers(transfers.value))
</script>

<template>
  <AppPage
    title="Transfers"
    subtitle="Move money between your own accounts. This never counts as income or spending."
  >
    <TransferForm />

    <h2 class="text-sm font-medium text-muted-foreground lg:text-base">Recent transfers</h2>

    <Card class="gap-0 overflow-hidden py-0">
      <p v-if="sortedTransfers.length === 0" class="px-4 py-6 text-sm text-muted-foreground lg:px-5">
        No transfers yet. Moves you make between your accounts will show up here.
      </p>

      <template v-else>
        <template v-for="(transfer, index) in sortedTransfers" :key="transfer.id">
          <Separator v-if="index > 0" />
          <TransferRow
            :transfer="transfer"
            :from-account="accountsById.get(transfer.fromAccountId) ?? null"
            :to-account="accountsById.get(transfer.toAccountId) ?? null"
          />
        </template>
      </template>
    </Card>
  </AppPage>
</template>
