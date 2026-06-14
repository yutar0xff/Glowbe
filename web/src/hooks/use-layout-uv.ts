import { startTransition, useEffect, useState } from 'react'
import type { LayoutUvResponse } from '@/types'
import { API_BASE } from '@/api'

export function useLayoutUv(layoutId: string, ledCount: number) {
  const [uv, setUv] = useState<LayoutUvResponse | null>(null)
  const [uvError, setUvError] = useState<string | null>(null)
  const [uvLoading, setUvLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    startTransition(() => {
      setUvLoading(true)
      setUv(null)
      setUvError(null)
    })
    ;(async () => {
      try {
        const r = await fetch(`${API_BASE}/api/v1/layout/uv`)
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j = (await r.json()) as LayoutUvResponse
        if (cancelled) return
        if (j.ledCount !== ledCount) {
          setUvError(
            `ledmap ledCount (${j.ledCount}) does not match runtime ledCount (${ledCount})`,
          )
          setUv(null)
        } else if (j.ledCount !== j.leds.length) {
          setUvError('ledCount does not match leds[] length')
          setUv(null)
        } else {
          setUv(j)
        }
      } catch (e) {
        if (!cancelled) {
          setUv(null)
          setUvError(e instanceof Error ? e.message : String(e))
        }
      } finally {
        if (!cancelled) setUvLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [layoutId, ledCount])

  return { uv, uvError, uvLoading }
}
