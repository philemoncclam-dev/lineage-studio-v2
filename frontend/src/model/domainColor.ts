import type { ColorKey } from '../data'

export const LAYER_COLOR: Record<string, ColorKey> = { bronze: 'bronze', silver: 'silver', gold: 'gold' }

export const colorFor = (layer: string): ColorKey => LAYER_COLOR[layer] ?? 'workspace'
