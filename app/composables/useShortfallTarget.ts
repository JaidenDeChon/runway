/**
 * Binds `app/lib/shortfall-target.ts`'s pure parsing to the current route.
 *
 * The route is the single source of truth (issue #14's Decision 2): `mode`,
 * `billId` and `date` are computed derivations of `route.query`, not refs
 * seeded from it once at mount, so the URL and the screen cannot disagree.
 * No financial arithmetic and no Supabase call lives here — this only reads
 * and writes three query params.
 */
import { type ComputedRef, computed, type Ref } from 'vue'
import type { LocationQueryRaw } from 'vue-router'
import {
  parseBillId,
  parseMode,
  parseTargetDate,
  resolveBillId,
  resolveMode,
  resolveTargetDate,
  SHORTFALL_QUERY,
  type ShortfallMode,
} from '@/lib/shortfall-target'
import type { IsoDate } from '~~/domain/dates'
import type { UpcomingBill } from '~~/domain/projection'

export interface ShortfallTarget {
  readonly mode: ComputedRef<ShortfallMode>
  readonly billId: ComputedRef<string | null>
  readonly date: ComputedRef<IsoDate>
  /** The day the question is asked about: the selected bill's date, else the picked date. */
  readonly through: ComputedRef<IsoDate>
  setMode(mode: ShortfallMode): void
  setBillId(id: string): void
  setDate(date: IsoDate): void
}

export function useShortfallTarget(
  bills: Ref<readonly UpcomingBill[]>,
  today: Ref<IsoDate>,
): ShortfallTarget {
  const route = useRoute()
  const router = useRouter()

  const billIds = computed(() => bills.value.map((bill) => bill.itemId))

  const mode = computed<ShortfallMode>(() =>
    resolveMode(parseMode(route.query[SHORTFALL_QUERY.mode]), bills.value.length > 0),
  )
  const billId = computed(() =>
    resolveBillId(parseBillId(route.query[SHORTFALL_QUERY.bill], billIds.value), billIds.value),
  )
  const date = computed<IsoDate>(() =>
    resolveTargetDate(parseTargetDate(route.query[SHORTFALL_QUERY.on], today.value), today.value),
  )

  const through = computed<IsoDate>(() => {
    if (mode.value !== 'bill') return date.value
    const bill = bills.value.find((candidate) => candidate.itemId === billId.value)
    return bill?.date ?? date.value
  })

  // `replace`, not `push`: otherwise every radio click or tab switch becomes a
  // browser-history entry and the back button stops leaving the page.
  // `Router.replace` resolves rather than rejects on a redundant navigation,
  // so `void` is safe here and no `.catch` is required.
  //
  // Spreads `...route.query`, like `setBillId`/`setDate` below: switching
  // modes must not drop the other mode's key, or a bill selection made
  // before a trip through date mode silently reverts to the first bill on
  // the way back — exactly what `docs/design/shortfall/spec.md:120` ("Mode
  // state is independent: switching back restores the previously selected
  // bill, and the date keeps its value") requires. Only fills in the target
  // mode's key when it is not already present, so a first-ever switch still
  // gets a concrete value rather than relying on the resolver's default.
  function setMode(next: ShortfallMode): void {
    const query: LocationQueryRaw = { ...route.query, [SHORTFALL_QUERY.mode]: next }
    if (next === 'bill' && !query[SHORTFALL_QUERY.bill] && billId.value) {
      query[SHORTFALL_QUERY.bill] = billId.value
    }
    if (next === 'date' && !query[SHORTFALL_QUERY.on]) {
      query[SHORTFALL_QUERY.on] = date.value
    }
    void router.replace({ query })
  }

  function setBillId(id: string): void {
    void router.replace({ query: { ...route.query, [SHORTFALL_QUERY.bill]: id } })
  }

  function setDate(next: IsoDate): void {
    void router.replace({ query: { ...route.query, [SHORTFALL_QUERY.on]: next } })
  }

  return { mode, billId, date, through, setMode, setBillId, setDate }
}
