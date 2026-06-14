import { createContext, useContext } from 'react'
import type { LoadState, OutputMode } from './types'

export type GlowbeRuntimeContextValue = {
  load: LoadState
  modeBusy: string | null
  sequenceBusy: string | null
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
  /** Refetch runtime state (e.g. after mate updates). */
  refreshLoad: () => Promise<void>
}

export const GlowbeRuntimeContext = createContext<GlowbeRuntimeContextValue | null>(null)

export function useGlowbeRuntime(): GlowbeRuntimeContextValue {
  const v = useContext(GlowbeRuntimeContext)
  if (!v) throw new Error('useGlowbeRuntime must be used within GlowbeRuntimeProvider')
  return v
}
