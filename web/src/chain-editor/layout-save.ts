import { API_BASE } from '@/api'
import type { GlowbeLayout } from '@/chain-editor/glowbe-layout-io'
import type { CompiledLayoutSummary } from '@/types'

export type SaveLayoutResponse = {
  layoutId: string
  layoutHash: number
  ledCount: number
  dataLineCount: number
  gpios: number[]
}

export function newCustomLayoutId(): string {
  const hex = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
  return `custom-${hex}`
}

export async function fetchLayoutCatalog(): Promise<CompiledLayoutSummary[]> {
  const res = await fetch(`${API_BASE}/api/v1/layouts`)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Could not list profiles (${res.status})`)
  }
  return (await res.json()) as CompiledLayoutSummary[]
}

export async function fetchLayoutSource(layoutId: string): Promise<GlowbeLayout> {
  const res = await fetch(`${API_BASE}/api/v1/layouts/${encodeURIComponent(layoutId)}/source`)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Could not load profile (${res.status})`)
  }
  return (await res.json()) as GlowbeLayout
}

export async function createChainProfile(layout: GlowbeLayout): Promise<SaveLayoutResponse> {
  const res = await fetch(`${API_BASE}/api/v1/layouts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(layout),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Create failed (${res.status})`)
  }
  return (await res.json()) as SaveLayoutResponse
}

export async function updateChainProfile(
  layoutId: string,
  layout: GlowbeLayout,
): Promise<SaveLayoutResponse> {
  const res = await fetch(`${API_BASE}/api/v1/layouts/${encodeURIComponent(layoutId)}/source`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(layout),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Save failed (${res.status})`)
  }
  return (await res.json()) as SaveLayoutResponse
}

export async function deleteChainProfile(layoutId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/v1/layouts/${encodeURIComponent(layoutId)}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Delete failed (${res.status})`)
  }
}

export async function duplicateChainProfile(
  sourceLayoutId: string,
  opts: { displayName?: string } = {},
): Promise<SaveLayoutResponse> {
  const catalog = await fetchLayoutCatalog()
  const row = catalog.find((r) => r.layoutId === sourceLayoutId)
  if (row?.sourceKind === 'preset') {
    const res = await fetch(
      `${API_BASE}/api/v1/layouts/${encodeURIComponent(sourceLayoutId)}/duplicate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: opts.displayName }),
      },
    )
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error ?? `Duplicate failed (${res.status})`)
    }
    const body = (await res.json()) as SaveLayoutResponse
    return body
  }

  const layout = await fetchLayoutSource(sourceLayoutId)
  const baseName = layout.displayName?.trim() || sourceLayoutId
  layout.id = newCustomLayoutId()
  layout.variant = 'custom'
  layout.displayName = opts.displayName?.trim() || `${baseName} (copy)`
  return createChainProfile(layout)
}
