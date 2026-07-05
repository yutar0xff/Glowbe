import type { InteractiveEffectKind } from '@/types'

export type InteractiveSettings = {
  pulseDurationMs: number
  pulseSigmaDeg: number
  interactiveEffect: InteractiveEffectKind
  colorRandom: boolean
  colorHex: string
  ringSpeed: number
  ringThicknessDeg: number
  solidBaseEnabled: boolean
  solidBaseHex: string
}

export const DEFAULT_INTERACTIVE_SETTINGS: InteractiveSettings = {
  pulseDurationMs: 450,
  pulseSigmaDeg: 8,
  interactiveEffect: 'expandingRingDiagonal',
  colorRandom: true,
  colorHex: '#c8f0ff',
  ringSpeed: 1,
  ringThicknessDeg: 0,
  solidBaseEnabled: false,
  solidBaseHex: '#101018',
}
