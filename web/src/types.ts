export type CompiledLayoutSummary = {
  layoutId: string
  displayName?: string
  ledCount: number
  variant?: string
  sourceKind?: 'preset' | 'user'
  dataLineCount?: number
  gpios?: number[]
  layoutHash?: number
  editable?: boolean
  inUseByDevices?: string[]
}

export type RuntimeState = {
  deviceId: string
  layoutId: string
  mode: string
  targetFps: number
  fpsOut: number
  fpsRx: number | null
  espFramesComplete: number | null
  espRssi: number | null
  espDrops: number | null
  espStatusAddr: string | null
  outputTargetAddr: string | null
  ledCount: number
  loopClipId: string | null
  /** Source frame index while a clip frame is sampled to the output buffer; null otherwise. */
  loopSourceFrame: number | null
  /** When true, loop timeline is frozen (clip frame does not advance). */
  loopPlaybackPaused: boolean
  uptimeSec: number
  frameLoopStaleMs: number
  layoutMismatch: boolean
  expectedLayoutHash?: number | null
  espLayoutHash?: number | null
  framesSent: number
  masterBrightness: number
  /** Device front yaw (deg). Rotates sampling UV around the vertical axis. */
  frontYawDeg: number
}

export type ClipSummary = {
  id: string
  kind: string
  frameCount: number
  fps: number
  width: number
  height: number
  sourceId?: string
  thumbFrameIndex?: number
  sourceKind?: string
  sourceWidth: number
  sourceHeight: number
  createdAtUnixSec: number
  displayName?: string
  isDemo?: boolean
  /** Loop-media gamma (demos are always 1). */
  gamma: number
}

export type SourceSummary = {
  id: string
  kind: string
  frameCount: number
  width: number
  height: number
  fps?: number
  createdAtUnixSec: number
  displayName?: string
}

export type ClipPlacement = {
  mode: 'equirect-planar' | 'stereographic' | string
  /** Planar: equirect patch center. */
  centerU: number
  centerV: number
  /** Stereographic: patch center orientation (RH yaw / elevation). */
  yawDeg: number
  pitchDeg: number
  scale: number
  /** Twist about patch outward axis. */
  rollDeg: number
  sourceAspect: number
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
  clipId?: string
  error?: string
  progress?: number
}

export type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; state: RuntimeState; health: Health; clips: ClipSummary[]; fetchedAt: Date }
  | { kind: 'error'; message: string; health?: Health; fetchedAt?: Date }

export type OutputMode = 'idle' | 'loop' | 'interactive' | 'mate' | 'text'

export { MATE_MIN_LED_COUNT, mateSupportedForLedCount } from '@/layout-ids'
export type {
  MateBreathingParams,
  MatePresetSummary,
  MatePresetsResponse,
} from '@/mate/types'
export type { TextModeParams } from '@/text/types'

export type InteractiveEffectKind = 'sphereGaussian' | 'expandingRingDiagonal'

export type DeviceRecord = {
  id: string
  displayName: string
  espIp?: string | null
  mdnsHostname?: string | null
  layoutId: string
  outputFps: number
  masterBrightness?: number
  frontYawDeg?: number
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
  state?: RuntimeState | null
}

export type DeviceCreateInput = {
  displayName: string
  espIp?: string | null
  mdnsHostname?: string | null
  layoutId: string
  outputFps: number
  masterBrightness?: number
  frontYawDeg?: number
}
