// element-id-safe short ids: 'table.raw_orders' -> 'raw_orders', 'notebook.x' -> 'nb_x'
// Shared by lineageLayout.ts, graphLayout.ts, and adapt.ts so none of them
// re-derive this mapping independently.
export const tid = (id: string) => id.replace(/^table\./, '').replace(/[^\w-]/g, '_')
export const nid = (id: string) => 'nb_' + id.replace(/^notebook\./, '').replace(/[^\w-]/g, '_')
