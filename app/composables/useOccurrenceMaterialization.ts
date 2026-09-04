/**
 * Keeps `public.occurrences` topped up as the calendar advances, for rules
 * that changed outside `useRunwayData().saveRecurringItem`'s own regeneration
 * — the horizon sliding forward being the main case (`domain/materialization.ts`
 * `materializationWindow`), and a rule planted directly in the database being
 * the other.
 *
 * Client-only and idempotent, by three independent guarantees layered on top
 * of each other — see `docs/database/schema.md`:
 *
 * 1. **It cannot run on the server.** `startHorizonUpkeep` returns
 *    immediately unless `import.meta.client`, and installs its watcher inside
 *    `onMounted`. A GET during SSR never performs a write.
 * 2. **It is deduplicated per session.** `mark` holds `` `${userId}@${today}` ``,
 *    set *before* the await so two synchronous callers cannot both fire, and
 *    cleared on failure so a later mount retries.
 * 3. **Even unguarded, it is a no-op.** `regenerate_occurrences`'s upsert
 *    only counts a row whose amount actually changed; a second identical run
 *    reports `{ upserted: 0, deleted: 0 }` and moves nothing.
 */

export function useOccurrenceMaterialization() {
  const { recurringItems, isLoading, regenerateOccurrences } = useRunwayData()
  const authUser = useAuthUser()
  const today = useToday()

  // Serialized from the server as null, so the client always runs once per
  // page load and then not again until the user or the calendar day changes
  // — exactly the two things that should force a re-run.
  const mark = useState<string | null>('runway-materialization-mark', () => null)

  async function ensureHorizon(): Promise<void> {
    if (!import.meta.client) return
    if (isLoading.value) return
    const userId = authUser.value?.id
    if (!userId) return
    if (recurringItems.value.length === 0) return

    const stamp = `${userId}@${today.value}`
    if (mark.value === stamp) return

    mark.value = stamp
    try {
      await regenerateOccurrences(today.value)
    } catch {
      // Already logged inside regenerateOccurrences, with a code and nothing
      // else. Clearing the mark lets the next mount (or the next reactive
      // trigger below) retry rather than staying stuck on a failed run.
      mark.value = null
    }
  }

  /** Installs the client-side top-up. Call once, at `<script setup>` top level. */
  function startHorizonUpkeep(): void {
    if (!import.meta.client) return
    onMounted(() => {
      watch(
        [
          () => authUser.value?.id ?? null,
          () => isLoading.value,
          () => today.value,
          () => recurringItems.value.length,
        ],
        () => {
          void ensureHorizon()
        },
        { immediate: true },
      )
    })
  }

  return { ensureHorizon, startHorizonUpkeep }
}
