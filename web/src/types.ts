export type RuntimeState = {
  layoutId: string
  mode: string
  fpsOut: number
  fpsRx: number | null
  espFramesComplete: number | null
  espRssi: number | null
  espDrops: number | null
  espStatusAddr: string | null
  outputTargetAddr: string | null
  ledCount: number
  loopSequenceId: string | null
  uptimeSec: number
  frameLoopStaleMs: number
  layoutMismatch: boolean
  framesSent: number
  masterBrightness: number
  masterGamma: number
}

export type SequenceSummary = {
  id: string
  layoutId: string
  ledCount: number
  frameCount: number
  fps: number
  sourceKind: string
  sourceWidth: number
  sourceHeight: number
  createdAtUnixSec: number
}

export type Health = {
  ok: boolean
  text: string
}

export type LayoutUvLed = {
  i: number
  u: number
  v: number
  channel?: number
  chainIndex?: number
}

export type LayoutUvResponse = {
  layoutId: string
  ledCount: number
  leds: LayoutUvLed[]
}

export type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; state: RuntimeState; health: Health; sequences: SequenceSummary[]; fetchedAt: Date }
  | { kind: 'error'; message: string; health?: Health; fetchedAt?: Date }

export type OutputMode = 'idle' | 'loop' | 'interactive'

export type InteractiveEffectKind = 'sphereGaussian' | 'expandingRingDiagonal'
