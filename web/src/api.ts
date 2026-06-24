import type {
  DeviceListResponse,
  DiscoveredEsp,
  Health,
  LoadState,
  RuntimeState,
  SequenceSummary,
} from './types'

export const API_BASE = import.meta.env.VITE_GLOWBE_API_BASE ?? ''
export const POLL_MS = 1000
export const DEVICE_URL_PARAM = 'device'

export function readActiveDeviceFromUrl(): string | null {
  const id = new URLSearchParams(location.search).get(DEVICE_URL_PARAM)
  return id && id.trim() ? id.trim() : null
}

export function writeActiveDeviceToUrl(deviceId: string) {
  const u = new URL(location.href)
  u.searchParams.set(DEVICE_URL_PARAM, deviceId)
  history.replaceState(null, '', `${u.pathname}${u.search}${u.hash}`)
}

export function apiDeviceQuery(deviceId: string | null | undefined): string {
  if (!deviceId) return ''
  return `?deviceId=${encodeURIComponent(deviceId)}`
}

export function resolveGlowbeWsUrl(deviceId?: string | null): string {
  const base = import.meta.env.VITE_GLOWBE_API_BASE ?? ''
  let url: URL
  if (!base) {
    const p = location.protocol === 'https:' ? 'wss:' : 'ws:'
    url = new URL(`${p}//${location.host}/api/v1/ws`)
  } else {
    const u = new URL(base.startsWith('http') ? base : `http://${base}`)
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
    u.pathname = '/api/v1/ws'
    u.search = ''
    u.hash = ''
    url = u
  }
  if (deviceId) {
    url.searchParams.set('deviceId', deviceId)
  }
  return url.toString()
}

async function fetchText(path: string, signal: AbortSignal): Promise<{
  ok: boolean
  status: number
  text: string
}> {
  const res = await fetch(`${API_BASE}${path}`, { signal })
  return { ok: res.ok, status: res.status, text: await res.text() }
}

export async function fetchDevices(signal: AbortSignal): Promise<DeviceListResponse> {
  const res = await fetch(`${API_BASE}/api/v1/devices`, { signal })
  if (!res.ok) throw new Error(`Could not list devices (error ${res.status}).`)
  return (await res.json()) as DeviceListResponse
}

export async function fetchDiscoveredEsps(signal: AbortSignal): Promise<DiscoveredEsp[]> {
  const res = await fetch(`${API_BASE}/api/v1/devices/discovered`, { signal })
  if (!res.ok) throw new Error(`Could not list discovered ESPs (error ${res.status}).`)
  return (await res.json()) as DiscoveredEsp[]
}

export async function fetchState(
  signal: AbortSignal,
  deviceId: string | null,
): Promise<LoadState> {
  const q = apiDeviceQuery(deviceId)
  const [stateRes, healthRes, sequencesRes] = await Promise.all([
    fetch(`${API_BASE}/api/v1/state${q}`, { signal }),
    fetchText('/health', signal).catch((err: unknown) => ({
      ok: false,
      status: 0,
      text: err instanceof Error ? err.message : String(err),
    })),
    fetch(`${API_BASE}/api/v1/sequences`, { signal }).catch(() => undefined),
  ])

  const health: Health = {
    ok: healthRes.ok,
    text: healthRes.ok ? healthRes.text : `${healthRes.status} ${healthRes.text}`,
  }

  if (!stateRes.ok) {
    return {
      kind: 'error',
      message: `Could not read runtime state (error ${stateRes.status}).`,
      health,
      fetchedAt: new Date(),
    }
  }

  return {
    kind: 'ready',
    state: (await stateRes.json()) as RuntimeState,
    health,
    sequences: sequencesRes?.ok ? ((await sequencesRes.json()) as SequenceSummary[]) : [],
    fetchedAt: new Date(),
  }
}
