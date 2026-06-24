export type MateDynamics = {
  stiffness: number
  damping: number
  floatiness: number
  trailLag: number
}

export type MateSummary = {
  expression: string
  mood: string
  idleRoutine: string
  gazeU: number
  gazeV: number
  gazePull: number
  cluster: number
  idleSpeed: number
  color: [number, number, number]
  brightness: number
  faceAngularRadiusDeg: number
  featureScale: number
  eyeSpacing: number
  dynamics: MateDynamics
  autoBreath: boolean
  autoBlink: boolean
  autoSaccade: boolean
  autoTremor: boolean
}

export type CompiledLayoutSummary = {
  layoutId: string
  displayName?: string
  ledCount: number
  variant?: string
}

export type RuntimeState = {
  deviceId: string
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
  /** Source frame index while a sequence frame is copied to the output buffer; null otherwise. */
  loopSourceFrame: number | null
  /** When true, loop timeline is frozen (sequence frame does not advance). */
  loopPlaybackPaused: boolean
  uptimeSec: number
  frameLoopStaleMs: number
  layoutMismatch: boolean
  framesSent: number
  masterBrightness: number
  masterGamma: number
  mate?: MateSummary | null
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
  /** Optional. When omitted, summaries may drop this field in list responses. */
  displayName?: string
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

export type MediaUploadStatusPayload = {
  uploadId: string
  status: 'stored' | 'running' | 'done' | 'failed'
  jobId?: string
  sequenceId?: string
  error?: string
  progress?: number
}

export type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; state: RuntimeState; health: Health; sequences: SequenceSummary[]; fetchedAt: Date }
  | { kind: 'error'; message: string; health?: Health; fetchedAt?: Date }

export type OutputMode = 'idle' | 'loop' | 'interactive' | 'mate'

export type InteractiveEffectKind = 'sphereGaussian' | 'expandingRingDiagonal'

export type DeviceRecord = {
  id: string
  displayName: string
  espIp?: string | null
  mdnsHostname?: string | null
  layoutId: string
}

export type DiscoveredEsp = {
  hostname: string
  ipv4: string
  port: number
  registeredDeviceId?: string | null
}

export type DeviceListResponse = {
  defaultDeviceId: string
  devices: DeviceRecord[]
  createdDeviceId?: string | null
}

export type DeviceCreateInput = {
  displayName: string
  espIp?: string | null
  mdnsHostname?: string | null
  layoutId: string
}
