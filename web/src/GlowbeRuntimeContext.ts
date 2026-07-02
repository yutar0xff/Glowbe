import { createContext, useContext } from 'react'
import type {
  DeviceCreateInput,
  DeviceRecord,
  LoadState,
  MateBreathingParams,
  OutputMode,
  TextModeParams,
} from './types'

export type GlowbeRuntimeContextValue = {
  load: LoadState
  activeDeviceId: string | null
  devices: DeviceRecord[]
  modeBusy: string | null
  clipBusy: string | null
  layoutBusy: boolean
  masterToneBusy: boolean
  mediaUploadBusy: boolean
  mediaConvertBusy: boolean
  mateExpressionBusy: string | null
  mateBreathingBusy: boolean
  textConfigBusy: boolean
  setMode: (mode: OutputMode) => Promise<void>
  /** Switch to mate mode and apply a face preset (morph transition on device). */
  setMateExpression: (preset: string, transitionMs?: number) => Promise<void>
  setMateBreathing: (params: Partial<MateBreathingParams> & { enabled: boolean }) => Promise<void>
  /** Switch to text mode and update flow params (partial patch). */
  setTextConfig: (params: Partial<TextModeParams>) => Promise<void>
  selectClip: (clipId: string) => Promise<void>
  /** Clears the selected clip and stays in loop mode (built-in test pattern). */
  clearLoopSelection: () => Promise<void>
  /** Pause or resume loop clip timeline (no-op if output is not looping). */
  setLoopPlaybackPaused: (paused: boolean) => Promise<void>
  setMasterTone: (brightness: number, gamma: number) => Promise<void>
  /** Upload only (`POST /api/v1/media/upload`, multipart `file`). */
  uploadMediaFile: (file: File) => Promise<{ uploadId: string }>
  /** Convert an uploaded asset by ID; polls until done, then refreshes the list. */
  convertMediaUpload: (
    uploadId: string,
    fps?: number,
    displayName?: string,
  ) => Promise<void>
  /** Empty string clears the display name in manifest.json. */
  setClipDisplayName: (clipId: string, displayName: string) => Promise<void>
  /** Remove a media clip from disk (server clears selection if it was playing). */
  deleteClip: (clipId: string) => Promise<void>
  /** Switch compiled LED layout (must match firmware flash). UV cache is refreshed; clip selection is kept. */
  setDeviceLayout: (layoutId: string) => Promise<void>
  /** Refetch runtime state from the server. */
  refreshLoad: () => Promise<void>
  /** Refetch device registry from runtime. */
  refreshDevices: () => Promise<void>
  setActiveDevice: (deviceId: string | null) => void
  upsertDevice: (input: DeviceCreateInput) => Promise<string | undefined>
  updateDevice: (record: DeviceRecord) => Promise<void>
  deleteDevice: (deviceId: string) => Promise<void>
}

export const GlowbeRuntimeContext = createContext<GlowbeRuntimeContextValue | null>(null)

export function useGlowbeRuntime(): GlowbeRuntimeContextValue {
  const v = useContext(GlowbeRuntimeContext)
  if (!v) throw new Error('useGlowbeRuntime must be used within GlowbeRuntimeProvider')
  return v
}
