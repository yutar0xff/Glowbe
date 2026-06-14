import type { Health, LoadState, RuntimeState, SequenceSummary } from './types'

export const API_BASE = import.meta.env.VITE_GLOWBE_API_BASE ?? ''
export const POLL_MS = 1000

export function resolveGlowbeWsUrl(): string {
  const base = import.meta.env.VITE_GLOWBE_API_BASE ?? ''
  if (!base) {
    const p = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${p}//${location.host}/api/v1/ws`
  }
  const u = new URL(base.startsWith('http') ? base : `http://${base}`)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  u.pathname = '/api/v1/ws'
  u.search = ''
  u.hash = ''
  return u.toString()
}

async function fetchText(path: string, signal: AbortSignal): Promise<{
  ok: boolean
  status: number
  text: string
}> {
  const res = await fetch(`${API_BASE}${path}`, { signal })
  return { ok: res.ok, status: res.status, text: await res.text() }
}

export async function fetchState(signal: AbortSignal): Promise<LoadState> {
  const [stateRes, healthRes, sequencesRes] = await Promise.all([
    fetch(`${API_BASE}/api/v1/state`, { signal }),
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
