import type { DeviceRecord, DiscoveredEsp } from '@/types'
import { validateOutputFps } from './device-output-settings'

export const DEFAULT_OUTPUT_FPS = 120
export const DEFAULT_MASTER_BRIGHTNESS = 1
export const DEFAULT_MASTER_GAMMA = 1

export type DeviceDraft = {
  displayName: string
  espIp: string
  mdnsHostname: string
  layoutId: string
  outputFps: string
  masterBrightness: number
  masterGamma: number
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
    masterGamma: DEFAULT_MASTER_GAMMA,
  }
}

export function editDraftFromRecord(
  rec: DeviceRecord,
  tone?: { brightness: number; gamma: number },
): DeviceDraft {
  return {
    displayName: rec.displayName ?? '',
    espIp: rec.espIp ?? '',
    mdnsHostname: formatMdnsHostnameForInput(rec.mdnsHostname),
    layoutId: rec.layoutId,
    outputFps: String(rec.outputFps),
    masterBrightness: rec.masterBrightness ?? tone?.brightness ?? DEFAULT_MASTER_BRIGHTNESS,
    masterGamma: rec.masterGamma ?? tone?.gamma ?? DEFAULT_MASTER_GAMMA,
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
    masterGamma: draft.masterGamma,
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
