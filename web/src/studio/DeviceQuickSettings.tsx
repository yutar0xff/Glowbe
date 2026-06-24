import type { DeviceRecord } from '@/types'
import { DeviceOutputSettingsRow } from './DeviceOutputSettingsRow'

export function DeviceQuickSettings({
  device,
  brightness,
  gamma,
  targetFps,
  busy,
  onToneCommit,
  onFpsCommit,
}: {
  device: DeviceRecord
  brightness: number
  gamma: number
  targetFps: number
  busy?: boolean
  onToneCommit: (brightness: number, gamma: number) => void
  onFpsCommit: (fps: number) => void | Promise<void>
}) {
  return (
    <DeviceOutputSettingsRow
      idPrefix={`device-${device.id}`}
      fps={targetFps}
      brightness={brightness}
      gamma={gamma}
      disabled={busy}
      onFpsCommit={onFpsCommit}
      onToneCommit={onToneCommit}
    />
  )
}
