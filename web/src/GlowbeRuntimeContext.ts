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
  setMasterTone: (brightness: number, gamma: number) => Promise<void>
  /** `POST /api/v1/media/upload` のみ（multipart `file`）。 */
  uploadMediaFile: (file: File) => Promise<{ uploadId: string }>
  /** アップロード済み ID に対して `POST …/convert` と進捗ポーリング。完了後に一覧を更新。 */
  convertMediaUpload: (
    uploadId: string,
    layoutId: string,
    fps?: number,
    displayName?: string,
  ) => Promise<void>
  /** Empty string clears the display name in manifest.json. */
  setSequenceDisplayName: (sequenceId: string, displayName: string) => Promise<void>
  /** シーケンスをディスクから削除（再生中ならサーバが選択解除）。 */
  deleteSequence: (sequenceId: string) => Promise<void>
}

export const GlowbeRuntimeContext = createContext<GlowbeRuntimeContextValue | null>(null)

export function useGlowbeRuntime(): GlowbeRuntimeContextValue {
  const v = useContext(GlowbeRuntimeContext)
  if (!v) throw new Error('useGlowbeRuntime must be used within GlowbeRuntimeProvider')
  return v
}
