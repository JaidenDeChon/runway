/**
 * The what-if session, shared between the header and the dashboard.
 *
 * Issue #16 made what-if a property of the dashboard *page*, held in two refs
 * inside `app/pages/index.vue`. That was right while the only two controls —
 * the day editor's switch and the persistent bar — were rendered by that page.
 * It stops being right the moment the toggle moves into the app header, which
 * `app/layouts/default.vue` renders: the layout is the page's parent, so a ref
 * declared in the page is not something the header can read, let alone set.
 *
 * So the state moves up, and this is where it lands. What it deliberately does
 * **not** do is gain durability on the way:
 *
 * - **`useState`, not a module-level `ref`.** A module `ref` is created once
 *   per server process and shared by every request that touches it, which on
 *   an SSR render is one user's previewed amounts leaking into another user's
 *   payload. `useState` is per-request on the server and per-app on the
 *   client, which is exactly the scope a preview should have.
 * - **No storage, no round trip.** Nothing here persists: not a cookie, not
 *   `localStorage`, not a row. A reload starts a fresh session with the mode
 *   off, which is the clean discard issue #16 asks for and
 *   `tests/e2e/occurrence-editor.spec.ts` pins.
 * - **`reset()` on the dashboard's unmount** keeps navigating away a discard
 *   too. Without it, `useState` would outlive the page and the previews would
 *   be waiting on return — stale numbers presented as a live forecast, which
 *   is the one failure mode this mode cannot have. The page owns that call;
 *   see `app/pages/index.vue`.
 *
 * The scratch list's *rules* stay in `app/lib/what-if.ts`, where they are
 * under unit test and where `tests/guards/what-if-write-isolation.test.ts` can
 * state as a fact about a file that they cannot reach storage. This composable
 * holds the refs and the three transitions; it computes nothing about money
 * and calls nothing that writes.
 */

import type { ComputedRef, Ref } from 'vue'
import { computed } from 'vue'
import type { WhatIfScratch } from '@/lib/what-if'
import { EMPTY_SCRATCH, hasScratchEdits, scratchKeys } from '@/lib/what-if'

export interface WhatIfSession {
  /** Whether the mode is on. The header switch and the day editor's switch both bind to this. */
  readonly on: Ref<boolean>
  /** The previewed edits. Written by the page's preview functions, never here. */
  readonly scratch: Ref<WhatIfScratch>
  readonly editCount: ComputedRef<number>
  /** Which occurrences are previewed, keyed by `occurrenceKey` — for the Upcoming rows. */
  readonly previewedKeys: ComputedRef<ReadonlySet<string>>
  /** Whether the user has asked to leave and not yet answered. The page renders the dialog. */
  readonly exitConfirmOpen: Ref<boolean>
  /** Turns the mode on or off outright. Off clears the previews. */
  set(on: boolean): void
  /** Leaves the mode, stopping to confirm only when there is something to lose. */
  requestExit(): void
  confirmExit(): void
  keepPreviewing(): void
  /** Ends the session without asking — for the page's own unmount. */
  reset(): void
}

export function useWhatIf(): WhatIfSession {
  const on = useState<boolean>('what-if:on', () => false)
  const scratch = useState<WhatIfScratch>('what-if:scratch', () => EMPTY_SCRATCH)
  const exitConfirmOpen = useState<boolean>('what-if:exit-confirm', () => false)

  const editCount = computed(() => scratch.value.length)
  const previewedKeys = computed(() => scratchKeys(scratch.value))

  /**
   * Clearing on the way *off* is belt and braces: `overridesInEffect` already
   * hides the list when the mode is off, so a forgotten clear would show
   * stored data rather than invented data. Both, in that order, is the
   * direction where a mistake is harmless.
   */
  function set(next: boolean): void {
    on.value = next
    if (!next) scratch.value = EMPTY_SCRATCH
  }

  function requestExit(): void {
    if (!hasScratchEdits(scratch.value)) {
      set(false)
      return
    }
    exitConfirmOpen.value = true
  }

  function confirmExit(): void {
    exitConfirmOpen.value = false
    set(false)
  }

  function keepPreviewing(): void {
    exitConfirmOpen.value = false
  }

  function reset(): void {
    exitConfirmOpen.value = false
    set(false)
  }

  return {
    on,
    scratch,
    editCount,
    previewedKeys,
    exitConfirmOpen,
    set,
    requestExit,
    confirmExit,
    keepPreviewing,
    reset,
  }
}
