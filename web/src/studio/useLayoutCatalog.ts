import { useEffect, useState } from 'react'
import type { CompiledLayoutSummary } from '@/types'
import { API_BASE } from '@/api'

export function useLayoutCatalog() {
  const [catalog, setCatalog] = useState<CompiledLayoutSummary[] | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/layouts`, { signal: ac.signal })
        if (!res.ok) return
        const rows = (await res.json()) as CompiledLayoutSummary[]
        setCatalog(rows)
      } catch {
        /* optional */
      }
    })()
    return () => ac.abort()
  }, [])

  const layoutLabel = (id: string) => {
    const row = catalog?.find((r) => r.layoutId === id)
    if (row?.displayName?.trim()) return row.displayName.trim()
    return id
  }

  return { catalog, layoutLabel }
}
