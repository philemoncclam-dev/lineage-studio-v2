import type { LineageGraph } from '../../api'

/**
 * Shared fixture used across model/__tests__/*: one workspace, two
 * lakehouses (bronze/silver), three tables, and one notebook that reads two
 * bronze tables and writes one silver table with column-level maps (one
 * pass-through, one computed transform). Small enough to hand-trace, rich
 * enough to exercise depth-2 layered layout, workspace/lakehouse drill
 * levels, and column-edge/transform resolution.
 */
export function sampleGraph(): LineageGraph {
  return {
    nodes: [
      { id: 'workspace.ws1', kind: 'workspace', name: 'Analytics', parent_id: null, columns: [], meta: {} },
      { id: 'lakehouse.bronze', kind: 'lakehouse', name: 'Bronze', parent_id: 'workspace.ws1', columns: [], meta: {} },
      { id: 'lakehouse.silver', kind: 'lakehouse', name: 'Silver', parent_id: 'workspace.ws1', columns: [], meta: {} },
      {
        id: 'table.raw_orders', kind: 'table', name: 'raw_orders', parent_id: 'lakehouse.bronze',
        columns: [{ name: 'order_id', data_type: 'long' }, { name: 'customer', data_type: 'string' }], meta: {},
      },
      {
        id: 'table.customers', kind: 'table', name: 'customers', parent_id: 'lakehouse.bronze',
        columns: [{ name: 'customer_id', data_type: 'long' }], meta: {},
      },
      {
        id: 'table.orders_clean', kind: 'table', name: 'orders_clean', parent_id: 'lakehouse.silver',
        columns: [{ name: 'order_id', data_type: 'long' }, { name: 'customer_name', data_type: 'string' }], meta: {},
      },
      {
        id: 'notebook.clean_orders', kind: 'notebook', name: 'clean_orders', parent_id: 'workspace.ws1',
        columns: [], meta: { source: 'print(1)' },
      },
    ],
    edges: [
      { source: 'table.raw_orders', target: 'notebook.clean_orders', kind: 'reads', columns: [] },
      { source: 'table.customers', target: 'notebook.clean_orders', kind: 'reads', columns: [] },
      {
        source: 'notebook.clean_orders', target: 'table.orders_clean', kind: 'writes',
        columns: [
          { from_column: 'order_id', to_column: 'order_id' },
          { from_column: 'upper(customer)', to_column: 'customer_name', transform: 'upper(customer)' },
        ],
      },
    ],
  }
}
