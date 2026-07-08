import type { DeviceRecord, DiscoveredEsp } from '@/types'
import { validateOutputFps } from './device-output-settings'

export const DEFAULT_OUTPUT_FPS = 120
export const DEFAULT_MASTER_BRIGHTNESS = 1
export const DEFAULT_FRONT_YAW_DEG = 0
export const FRONT_YAW_DEG_MIN = -180
export const FRONT_YAW_DEG_MAX = 180

export type DeviceDraft = {
  displayName: string
  espIp: string
  mdnsHostname: string
  layoutId: string
  outputFps: string
  masterBrightness: number
  frontYawDeg: number
}

export function clampFrontYawDeg(deg: number): number {
  if (!Number.isFinite(deg)) return DEFAULT_FRONT_YAW_DEG
  return Math.min(FRONT_YAW_DEG_MAX, Math.max(FRONT_YAW_DEG_MIN, deg))
}

export function normalizeMdnsHostname(raw: string): string {
  let s = raw.trim().replace(/\.+$/, '')
  if (s.endsWith('.local')) s = s.slice(0, -'.local'.length).replace(/\.+$/, '')
  return s
}

export function formatMdnsHostnameForInput(host: string | null | undefined): string {
  const normalized = normalizeMdnsHostname(host ?? '')
  if (!normalized) return ''
  return `${normalized}.local`
}

export function listDisplayName(rec: DeviceRecord): string {
  const name = rec.displayName?.trim()
  if (name) return name
  return 'Unnamed device'
}

export function emptyCreateDraft(layoutId: string, outputFps: number): DeviceDraft {
  return {
    displayName: '',
    espIp: '',
    mdnsHostname: '',
    layoutId,
    outputFps: String(outputFps),
    masterBrightness: DEFAULT_MASTER_BRIGHTNESS,
    frontYawDeg: DEFAULT_FRONT_YAW_DEG,
  }
}

export function editDraftFromRecord(
  rec: DeviceRecord,
  tone?: { brightness: number },
): DeviceDraft {
  return {
    displayName: rec.displayName ?? '',
    espIp: rec.espIp ?? '',
    mdnsHostname: formatMdnsHostnameForInput(rec.mdnsHostname),
    layoutId: rec.layoutId,
    outputFps: String(rec.outputFps),
    masterBrightness: rec.masterBrightness ?? tone?.brightness ?? DEFAULT_MASTER_BRIGHTNESS,
    frontYawDeg: rec.frontYawDeg ?? DEFAULT_FRONT_YAW_DEG,
  }
}

export function parseDraftFps(raw: string): number {
  const result = validateOutputFps(raw)
  return result.ok ? result.value : DEFAULT_OUTPUT_FPS
}

export function toRecord(id: string, draft: DeviceDraft): DeviceRecord | { error: string } {
  const fps = validateOutputFps(draft.outputFps)
  if (!fps.ok) return { error: fps.error }

  return {
    id,
    displayName:
      draft.displayName.trim() ||
      listDisplayName({
        id,
        displayName: '',
        layoutId: draft.layoutId,
        outputFps: fps.value,
        espIp: null,
        mdnsHostname: null,
      }),
    espIp: draft.espIp.trim() || null,
    mdnsHostname: draft.mdnsHostname.trim() ? normalizeMdnsHostname(draft.mdnsHostname) : null,
    layoutId: draft.layoutId.trim(),
    outputFps: fps.value,
    masterBrightness: draft.masterBrightness,
    frontYawDeg: clampFrontYawDeg(draft.frontYawDeg),
  }
}

export function applyDiscoveredToDraft(draft: DeviceDraft, esp: DiscoveredEsp): DeviceDraft {
  return {
    ...draft,
    espIp: esp.ipv4,
    mdnsHostname: formatMdnsHostnameForInput(esp.hostname),
    displayName: draft.displayName.trim() || normalizeMdnsHostname(esp.hostname),
  }
}
