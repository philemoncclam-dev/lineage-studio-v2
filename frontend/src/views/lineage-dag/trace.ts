// Ported verbatim from the retired frontend/src/views/LineageView.tsx (lines
// 10-21) — walks upstream + downstream from a column key over the flat
// colEdges array, with a visited-guard (`set.has`) that makes it terminate
// on cyclic input. Same algorithm, now independently unit-testable and
// reused by the DAG canvas's hover/selection trace (DAG-03/DAG-04).

export function trace(colEdges: [string, string][], id: string): Set<string> {
  const set = new Set<string>()
  const go = (c: string, dir: number) => {
    set.add(c)
    for (const [s, t] of colEdges) {
      if (dir >= 0 && s === c && !set.has(t)) go(t, 1)
      if (dir <= 0 && t === c && !set.has(s)) go(s, -1)
    }
  }
  go(id, 0)
  return set
}
