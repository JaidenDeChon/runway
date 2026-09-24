<script setup lang="ts">
/**
 * The "this amount is an estimate" marker — issue #18.
 *
 * Borrowed from the recurring-items design, which is the only screen with a
 * designed estimate marker: `RecurringItemRow`'s "Est." Badge (`--accent`
 * fill, `--muted-foreground` text; docs/design/recurring-items/spec.md, Token
 * usage). The dashboard has no designed marker of its own, so the Upcoming
 * rows and the day editor reuse this one rather than inventing a second
 * vocabulary for the same fact.
 *
 * The abbreviation is expanded for assistive technology, as the same spec's
 * accessibility notes ask ("Est." needs an expansion). Visible text rather than
 * an `aria-label` on the badge: these rows are buttons whose accessible name is
 * their content, and a label on a role-less span is not reliably announced.
 */
import { Badge } from '@/components/ui/badge'
</script>

<template>
  <Badge class="shrink-0 border-transparent bg-accent text-muted-foreground">
    <span aria-hidden="true">Est.</span>
    <span class="sr-only">Estimated amount</span>
  </Badge>
</template>
