// Composition root for the model layer: the AppModel/TableContext contract,
// the bundled sample data, the React context that carries the live-or-sample
// AppModel to every view, and a re-export of adapt() so `./model` remains a
// single stable import surface for all four view consumers.

import { createContext, useContext } from 'react'
import {
  COL_EDGES, LEVELS, LEVEL_TABLE, NOTEBOOKS, NOTEBOOK_CODE, OPS, TABLES, XFORM,
  type NB, type Level, type Table,
} from '../data'

export interface TableContext {
  up: [string, string, string][]   // [name, layer, via]
  down: [string, string, string][]
}

export interface AppModel {
  source: 'live' | 'sample'
  tables: Table[]
  notebooks: NB[]
  colEdges: [string, string][]
  ops: [string, string, 'reads' | 'writes'][]
  xform: Record<string, [string, string]>
  levels: Record<string, Level>
  levelTable: Record<string, string>
  notebookCode: Record<string, string>
  context: Record<string, TableContext>
}

export function sampleModel(): AppModel {
  return {
    source: 'sample',
    tables: TABLES, notebooks: NOTEBOOKS, colEdges: COL_EDGES, ops: OPS, xform: XFORM,
    levels: LEVELS, levelTable: LEVEL_TABLE, notebookCode: NOTEBOOK_CODE,
    context: {
      clean: {
        up: [['raw_orders', 'bronze', 'clean_orders'], ['raw_customers', 'bronze', 'clean_orders']],
        down: [['orders_report', 'gold', 'daily_revenue'], ['revenue_daily', 'gold', 'daily_revenue'], ['customer_360', 'gold', 'build_customer_360']],
      },
    },
  }
}

const ModelContext = createContext<AppModel>(sampleModel())
export const ModelProvider = ModelContext.Provider
export const useModel = () => useContext(ModelContext)

export { adapt } from './adapt'
