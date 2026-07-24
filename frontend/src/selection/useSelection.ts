// Selection search-param store (D-08/D-11). `?sel`/`?col` ARE the selection
// state — no separate client store exists (RESEARCH.md Pattern 1, Anti-
// Patterns). This is the SINGLE selection write path: no other module may
// call navigate({ search }) for selection (Pitfall 1) — every write goes
// through select()/clear() below, which always passes replace: true so
// selection clicks never flood browser history (SHELL-06 vs D-08).
//
// Reads via the generic `useSearch({ strict: false })` rather than a
// specific route's `Route.useSearch()` so this one hook works from any mode
// that declares the selectionSchema on its mode-level route (see
// routes/graph/route.tsx).
import { useNavigate, useSearch } from '@tanstack/react-router'
import { z } from 'zod'

export const selectionSchema = z.object({
  sel: z.string().optional(),
  col: z.string().optional(),
})

export type SelectionSearch = z.infer<typeof selectionSchema>

export interface UseSelectionResult {
  sel: string | undefined
  col: string | undefined
  select: (nodeId?: string, colKey?: string) => void
  clear: () => void
}

export function useSelection(): UseSelectionResult {
  const search = useSearch({ strict: false }) as SelectionSearch
  const navigate = useNavigate()

  const select = (nodeId?: string, colKey?: string) => {
    // `navigate()` without a `from` can't statically narrow the search-param
    // type across every route in the tree; the runtime shape is exactly
    // `selectionSchema`, which the graph mode route declares via validateSearch.
    void navigate({
      search: ((prev: Record<string, unknown>) => ({ ...prev, sel: nodeId, col: colKey })) as never,
      replace: true,
    })
  }

  const clear = () => select(undefined, undefined)

  return { sel: search.sel, col: search.col, select, clear }
}
