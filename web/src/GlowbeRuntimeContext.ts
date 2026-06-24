import { createContext, useContext } from 'react'
import type { DeviceCreateInput, DeviceRecord, LoadState, OutputMode } from './types'

export type GlowbeRuntimeContextValue = {
  load: LoadState
  activeDeviceId: string | null
  devices: DeviceRecord[]
  modeBusy: string | null
  sequenceBusy: string | null
  layoutBusy: boolean
  masterToneBusy: boolean
  mediaUploadBusy: boolean
  mediaConvertBusy: boolean
  setMode: (mode: OutputMode) => Promise<void>
  selectSequence: (sequenceId: string) => Promise<void>
  /** Clears the selected sequence and stays in loop mode (built-in test pattern). */
  clearLoopSelection: () => Promise<void>
  /** Pause or resume loop sequence timeline (no-op if output is not looping). */
  setLoopPlaybackPaused: (paused: boolean) => Promise<void>
  setMasterTone: (brightness: number, gamma: number) => Promise<void>
  /** Upload only (`POST /api/v1/media/upload`, multipart `file`). */
  uploadMediaFile: (file: File) => Promise<{ uploadId: string }>
  /** Convert an uploaded asset by ID; polls until done, then refreshes the list. */
  convertMediaUpload: (
    uploadId: string,
    layoutId: string,
    fps?: number,
    displayName?: string,
  ) => Promise<void>
  /** Empty string clears the display name in manifest.json. */
  setSequenceDisplayName: (sequenceId: string, displayName: string) => Promise<void>
  /** Remove a sequence from disk (server clears selection if it was playing). */
  deleteSequence: (sequenceId: string) => Promise<void>
  /** Switch compiled LED layout (must match firmware flash). Clears loop selection if sequence mismatches. */
  setDeviceLayout: (layoutId: string) => Promise<void>
  /** Refetch runtime state (e.g. after mate updates). */
  refreshLoad: () => Promise<void>
  /** Refetch device registry from runtime. */
  refreshDevices: () => Promise<void>
  setActiveDevice: (deviceId: string) => void
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
