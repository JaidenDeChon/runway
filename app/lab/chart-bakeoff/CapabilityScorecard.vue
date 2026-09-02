<script setup lang="ts">
/**
 * One `CandidateReport`, rendered as a table.
 *
 * The 375px gate (capability 8) is not just another scored row: it is marked
 * "GATE" and, when it fails, every other row in the table is dimmed and
 * labelled "disqualified" — the issue is explicit that a gate failure is not
 * something to average into a score.
 */
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { CandidateReport, VerdictStatus } from './candidates'
import { CAPABILITIES } from './capabilities'

const props = defineProps<{
  report: CandidateReport
}>()

const gateFailed = computed(() => {
  const gate = props.report.verdicts.legible375
  return gate?.status === 'fail'
})

function badgeClass(status: VerdictStatus): string {
  switch (status) {
    case 'pass':
      return 'bg-chart-positive/16 text-chart-positive'
    case 'partial':
      return 'bg-chart-warning/16 text-chart-warning'
    case 'fail':
      return 'bg-destructive/16 text-destructive'
  }
}
</script>

<template>
  <div>
    <p v-if="gateFailed" class="mb-2 text-sm font-medium text-destructive">
      Disqualified — fails the 375px legibility gate (capability 8). The rows below are informational
      only; a gate failure is not averaged into a score.
    </p>
    <div class="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Capability</TableHead>
            <TableHead class="w-28">Verdict</TableHead>
            <TableHead>Note</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="capability in CAPABILITIES"
            :key="capability.id"
            :class="cn(gateFailed && !capability.gate && 'opacity-50')"
          >
            <TableCell class="align-top">
              {{ capability.label }}
              <span v-if="capability.gate" class="ml-1 text-xs font-semibold text-muted-foreground"
                >(GATE)</span
              >
            </TableCell>
            <TableCell class="align-top">
              <Badge :class="badgeClass(props.report.verdicts[capability.id].status)">
                {{ props.report.verdicts[capability.id].status }}
              </Badge>
            </TableCell>
            <TableCell class="align-top text-sm text-muted-foreground">
              {{ props.report.verdicts[capability.id].note }}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  </div>
</template>
