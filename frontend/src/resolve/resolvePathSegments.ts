// Name -> GUID path-segment resolution (D-07) plus the nearest-resolvable-
// ancestor redirect fallback (D-09/Pitfall 4). Resolution always happens
// against the caller-supplied graph snapshot — callers must pass the
// ROOT-loaded LineageGraph, never a partial/intermediate state (Pitfall 4).
//
// resolvePathSegments always redirects with replace: true so a bad pasted
// URL never becomes a back-button trap, and it redirects exactly once: the
// ancestor target is built only from segments that already resolved
// successfully in this same call, never by re-attempting resolution.
import { redirect } from '@tanstack/react-router'
import type { LineageGraph, NodeKind } from '../api'

// The D-09 notice is rendered as a plain JSX text child (never
// dangerouslySetInnerHTML — React escapes it by default) by the shell that
// reads this search param; bounding its length here means a pathological
// URL segment can't blow out that banner's layout.
const MAX_NOTICE_LEN = 64

export function resolveSegment(
  graph: LineageGraph,
  kind: NodeKind,
  name: string,
  parentGuid?: string,
): string | null {
  const match = graph.nodes.find(
    (n) => n.kind === kind && n.name === name && (parentGuid !== undefined ? n.parent_id === parentGuid : true),
  )
  return match?.id ?? null
}

function boundNotice(segment: string): string {
  return segment.length > MAX_NOTICE_LEN ? `${segment.slice(0, MAX_NOTICE_LEN)}…` : segment
}

export interface DrillParams {
  workspace?: string
  lakehouse?: string
  table?: string
}

export interface ResolvedDrill {
  workspaceId?: string
  lakehouseId?: string
  tableId?: string
}

interface AncestorTarget {
  to: string
  params?: Record<string, string>
}

/**
 * Resolves readable-name path params in workspace -> lakehouse -> table
 * order. On the first segment that fails to resolve, throws
 * redirect({ replace: true }) to the nearest resolvable ancestor (the last
 * successfully-resolved level, or `rootTo` if none resolved yet), attaching
 * a length-bounded `unresolved` search param naming the failed segment.
 * An absent/empty optional segment is simply skipped — not a failure — so a
 * shorter path (e.g. just `{ workspace }`) resolves cleanly with no redirect.
 */
export function resolvePathSegments(graph: LineageGraph, params: DrillParams, rootTo: AncestorTarget): ResolvedDrill {
  const resolved: ResolvedDrill = {}
  let ancestor: AncestorTarget = rootTo

  const fail = (segment: string): never => {
    // `redirect()`'s target route (`ancestor.to`) is only known at runtime
    // here (it varies per call site) and the `unresolved` notice param
    // isn't part of selectionSchema, so this can't be statically typed
    // against one specific route's search shape — see useSelection.ts.
    throw redirect({
      to: ancestor.to,
      params: ancestor.params,
      replace: true,
      search: ((prev: Record<string, unknown>) => ({ ...prev, unresolved: boundNotice(segment) })) as never,
    } as never)
  }

  if (params.workspace !== undefined) {
    const id = resolveSegment(graph, 'workspace', params.workspace)
    if (!id) fail(params.workspace)
    resolved.workspaceId = id as string
    ancestor = { to: '/graph/$workspace', params: { workspace: params.workspace } }
  }

  if (params.lakehouse !== undefined) {
    const id = resolved.workspaceId ? resolveSegment(graph, 'lakehouse', params.lakehouse, resolved.workspaceId) : null
    if (!id) fail(params.lakehouse)
    resolved.lakehouseId = id as string
    ancestor = {
      to: '/graph/$workspace/$lakehouse',
      params: { workspace: params.workspace!, lakehouse: params.lakehouse },
    }
  }

  if (params.table !== undefined) {
    const id = resolved.lakehouseId ? resolveSegment(graph, 'table', params.table, resolved.lakehouseId) : null
    if (!id) fail(params.table)
    resolved.tableId = id as string
  }

  return resolved
}
