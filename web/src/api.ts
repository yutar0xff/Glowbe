import type {
  DeviceListResponse,
  DiscoveredEsp,
  Health,
  LoadState,
  MateBreathingParams,
  MatePresetsResponse,
  RuntimeState,
  ClipSummary,
  TextModeParams,
} from './types'

export const API_BASE = import.meta.env.VITE_GLOWBE_API_BASE ?? ''
export const POLL_MS = 1000
export const DEVICE_URL_PARAM = 'device'

export function readActiveDeviceFromUrl(): string | null {
  const id = new URLSearchParams(location.search).get(DEVICE_URL_PARAM)
  return id && id.trim() ? id.trim() : null
}

export function writeActiveDeviceToUrl(deviceId: string | null) {
  const u = new URL(location.href)
  if (deviceId) {
    u.searchParams.set(DEVICE_URL_PARAM, deviceId)
  } else {
    u.searchParams.delete(DEVICE_URL_PARAM)
  }
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

export async function fetchMatePresets(
  signal: AbortSignal,
  deviceId: string | null,
): Promise<MatePresetsResponse> {
  const q = apiDeviceQuery(deviceId)
  const res = await fetch(`${API_BASE}/api/v1/mate/presets${q}`, { signal })
  if (!res.ok) {
    const msg = await res.text()
    throw new Error(msg || `Could not list mate presets (error ${res.status}).`)
  }
  return (await res.json()) as MatePresetsResponse
}

export async function postMateExpression(
  signal: AbortSignal,
  deviceId: string | null,
  preset: string,
  transitionMs: number,
): Promise<RuntimeState> {
  const q = apiDeviceQuery(deviceId)
  const res = await fetch(`${API_BASE}/api/v1/mate/expression${q}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ preset, transitionMs }),
    signal,
  })
  if (!res.ok) {
    const msg = await res.text()
    try {
      const j = JSON.parse(msg) as { error?: string }
      if (j.error) throw new Error(j.error)
    } catch (e) {
      if (e instanceof Error && e.message !== msg) throw e
    }
    throw new Error(msg || `Could not set mate expression (error ${res.status}).`)
  }
  return (await res.json()) as RuntimeState
}

export async function postMateBreathing(
  signal: AbortSignal,
  deviceId: string | null,
  params: Partial<MateBreathingParams> & { enabled: boolean },
): Promise<RuntimeState> {
  const q = apiDeviceQuery(deviceId)
  const res = await fetch(`${API_BASE}/api/v1/mate/breathing${q}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
    signal,
  })
  if (!res.ok) {
    const msg = await res.text()
    try {
      const j = JSON.parse(msg) as { error?: string }
      if (j.error) throw new Error(j.error)
    } catch (e) {
      if (e instanceof Error && e.message !== msg) throw e
    }
    throw new Error(msg || `Could not set mate breathing (error ${res.status}).`)
  }
  return (await res.json()) as RuntimeState
}

export async function postMateTransition(
  signal: AbortSignal,
  deviceId: string | null,
  rotate: boolean,
): Promise<RuntimeState> {
  const q = apiDeviceQuery(deviceId)
  const res = await fetch(`${API_BASE}/api/v1/mate/transition${q}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rotate }),
    signal,
  })
  if (!res.ok) {
    const msg = await res.text()
    try {
      const j = JSON.parse(msg) as { error?: string }
      if (j.error) throw new Error(j.error)
    } catch (e) {
      if (e instanceof Error && e.message !== msg) throw e
    }
    throw new Error(msg || `Could not set mate transition (error ${res.status}).`)
  }
  return (await res.json()) as RuntimeState
}

export async function fetchTextConfig(
  signal: AbortSignal,
  deviceId: string | null,
): Promise<TextModeParams> {
  const q = apiDeviceQuery(deviceId)
  const res = await fetch(`${API_BASE}/api/v1/text/config${q}`, { signal })
  if (!res.ok) {
    const msg = await res.text()
    throw new Error(msg || `Could not load text config (error ${res.status}).`)
  }
  return (await res.json()) as TextModeParams
}

export async function postTextConfig(
  signal: AbortSignal,
  deviceId: string | null,
  params: Partial<TextModeParams>,
): Promise<RuntimeState> {
  const q = apiDeviceQuery(deviceId)
  const res = await fetch(`${API_BASE}/api/v1/text/config${q}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
    signal,
  })
  if (!res.ok) {
    const msg = await res.text()
    try {
      const j = JSON.parse(msg) as { error?: string }
      if (j.error) throw new Error(j.error)
    } catch (e) {
      if (e instanceof Error && e.message !== msg) throw e
    }
    throw new Error(msg || `Could not set text config (error ${res.status}).`)
  }
  return (await res.json()) as RuntimeState
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
  const [stateRes, healthRes, clipsRes] = await Promise.all([
    fetch(`${API_BASE}/api/v1/state${q}`, { signal }),
    fetchText('/health', signal).catch((err: unknown) => ({
      ok: false,
      status: 0,
      text: err instanceof Error ? err.message : String(err),
    })),
    fetch(`${API_BASE}/api/v1/clips`, { signal }).catch(() => undefined),
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
    clips: clipsRes?.ok ? ((await clipsRes.json()) as ClipSummary[]) : [],
    fetchedAt: new Date(),
  }
}
