import type { ColorKey } from '../data'

export const LAYER_COLOR: Record<string, ColorKey> = { bronze: 'bronze', silver: 'silver', gold: 'gold' }

// Exact match wins (the sample data's lakehouse names are exactly bronze /
// silver / gold). Otherwise fall back to a substring scan so authored layer
// names exported from the modelling tab — "P-S (Bronze)", "Gold (Dimensional)"
// — still pick up their medallion colour instead of the neutral default.
export const colorFor = (layer: string): ColorKey => {
  if (LAYER_COLOR[layer]) return LAYER_COLOR[layer]
  for (const key of ['bronze', 'silver', 'gold'] as const) {
    if (layer.includes(key)) return key
  }
  return 'workspace'
}
