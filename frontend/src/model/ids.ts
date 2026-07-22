// element-id-safe short ids: 'table.raw_orders' -> 'raw_orders', 'notebook.x' -> 'nb_x'
// Shared by lineageLayout.ts, graphLayout.ts, and adapt.ts so none of them
// re-derive this mapping independently.
//
// WR-03 fix: naive `.replace(/[^\w-]/g, '_')` collapsed interior '.' and
// literal '_' onto the same character, so 'table.raw.orders' and
// 'table.raw_orders' both produced 'raw_orders' — a silent collision on
// real Fabric ids (which do contain interior dots) that the punctuation-free
// sample fixture never surfaced. Interior '.' is now encoded as a distinct
// '__' token before the generic non-word-char fallback runs, so the two
// diverge while every fixture id without interior dots is unaffected.
const sanitize = (s: string) => s.replace(/\./g, '__').replace(/[^\w-]/g, '_')

export const tid = (id: string) => sanitize(id.replace(/^table\./, ''))
export const nid = (id: string) => 'nb_' + sanitize(id.replace(/^notebook\./, ''))
