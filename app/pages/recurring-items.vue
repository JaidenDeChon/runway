<script setup lang="ts">
import { Plus } from '@lucide/vue'
import { computed, ref } from 'vue'
import AppPage from '@/components/AppPage.vue'
import RecurringItemEditor from '@/components/recurring-items/RecurringItemEditor.vue'
import RecurringItemRow from '@/components/recurring-items/RecurringItemRow.vue'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useRunwayData } from '@/composables/useRunwayData'
import { SEGMENTED_SEGMENT, SEGMENTED_TRACK } from '@/lib/segmented-control'
import { cn } from '@/lib/utils'
import { compareDates } from '~~/domain/dates'
import type { RecurringItem, RecurringKind } from '~~/domain/types'

useHead({ title: 'Recurring Items - Runway' })

const { recurringItems, accountsById } = useRunwayData()

type Filter = 'all' | RecurringKind

const filter = ref<Filter>('all')

// Filter is view-local and never touches the store; sort order is recomputed
// from `nextOccurrence` on every change so it stays correct after an edit.
const rows = computed(() =>
  [...recurringItems.value]
    .filter((item) => filter.value === 'all' || item.kind === filter.value)
    .sort(
      (a, b) => compareDates(a.nextOccurrence, b.nextOccurrence) || a.name.localeCompare(b.name),
    )
    .map((item) => ({ item, account: accountsById.value.get(item.accountId) })),
)

const editorOpen = ref(false)
const editing = ref<RecurringItem | null>(null)

function openEdit(item: RecurringItem): void {
  editing.value = item
  editorOpen.value = true
}

function openAdd(): void {
  editing.value = null
  editorOpen.value = true
}
</script>

<template>
  <AppPage title="Recurring" subtitle="Bills and income that shape your runway.">
    <template #actions>
      <!-- Desktop placement of the same action the dashed in-card button
           offers on mobile; only ever one of the two is visible. -->
      <Button class="hidden lg:inline-flex" @click="openAdd">
        <Plus aria-hidden="true" class="size-4" />
        Add recurring item
      </Button>
    </template>

    <ToggleGroup
      type="single"
      :class="cn(SEGMENTED_TRACK, 'w-fit gap-0')"
      :model-value="filter"
      aria-label="Filter recurring items"
      @update:model-value="(value) => value && (filter = value as Filter)"
    >
      <ToggleGroupItem
        value="all"
        :class="cn(SEGMENTED_SEGMENT, 'h-11 px-4 text-sm font-medium')"
      >
        All
      </ToggleGroupItem>
      <ToggleGroupItem
        value="bill"
        :class="cn(SEGMENTED_SEGMENT, 'h-11 px-4 text-sm font-medium')"
      >
        Bills
      </ToggleGroupItem>
      <ToggleGroupItem
        value="income"
        :class="cn(SEGMENTED_SEGMENT, 'h-11 px-4 text-sm font-medium')"
      >
        Income
      </ToggleGroupItem>
    </ToggleGroup>

    <Card class="gap-0 overflow-hidden py-0">
      <p v-if="recurringItems.length === 0" class="px-4 py-6 text-sm text-muted-foreground">
        No recurring bills or income yet. Add your first one below.
      </p>
      <p v-else-if="rows.length === 0" class="px-4 py-6 text-sm text-muted-foreground">
        No items match this filter.
      </p>

      <template v-else>
        <div v-for="(row, index) in rows" :key="row.item.id" :class="index > 0 ? 'border-t' : ''">
          <RecurringItemRow :item="row.item" :account="row.account" @select="openEdit(row.item)" />
        </div>
      </template>

      <div class="border-t p-3 lg:hidden">
        <Button variant="outline" class="w-full border-dashed text-primary" @click="openAdd">
          <Plus aria-hidden="true" class="size-4" />
          Add recurring item
        </Button>
      </div>
    </Card>

    <RecurringItemEditor v-model:open="editorOpen" :item="editing" />
  </AppPage>
</template>
