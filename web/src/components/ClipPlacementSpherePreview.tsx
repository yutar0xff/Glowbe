import { useEffect, useMemo, useState } from 'react'
import { LayoutUvSphereCanvas, type SphereLedOverlay } from '@/components/LayoutUvSphereCanvas'
import { Button } from '@/components/ui/button'
import { API_BASE } from '@/api'
import {
  LAYOUT_ID_GEODESIC_2V_60,
  LAYOUT_ID_ICOSAHEDRON_15,
} from '@/layout-ids'
import type { LayoutUvResponse } from '@/types'

const PRESET_LAYERS = [
  {
    id: LAYOUT_ID_GEODESIC_2V_60,
    label: 'Geodesic 2V',
    color: '#0e7490',
    emissive: '#22d3ee',
  },
  {
    id: LAYOUT_ID_ICOSAHEDRON_15,
    label: 'Icosahedron 15',
    color: '#a16207',
    emissive: '#fbbf24',
  },
] as const

async function fetchLayoutUvById(layoutId: string, signal?: AbortSignal): Promise<LayoutUvResponse> {
  const res = await fetch(`${API_BASE}/api/v1/layouts/${encodeURIComponent(layoutId)}/uv`, {
    signal,
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(t || `HTTP ${res.status}`)
  }
  return (await res.json()) as LayoutUvResponse
}

/**
 * Placement preview: shared Studio sphere canvas + equirect texture + optional preset LED overlays.
 */
export function ClipPlacementSpherePreview({
  textureUrl,
  className,
}: {
  textureUrl: string | null
  className?: string
}) {
  const [uvById, setUvById] = useState<Record<string, LayoutUvResponse | null>>({})
  const [visible, setVisible] = useState<Record<string, boolean>>({
    [LAYOUT_ID_GEODESIC_2V_60]: true,
    [LAYOUT_ID_ICOSAHEDRON_15]: false,
  })
  const [loadErr, setLoadErr] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      setLoadErr(null)
      try {
        const entries = await Promise.all(
          PRESET_LAYERS.map(async (p) => {
            const uv = await fetchLayoutUvById(p.id, controller.signal)
            return [p.id, uv] as const
          }),
        )
        if (controller.signal.aborted) return
        setUvById(Object.fromEntries(entries))
      } catch (e) {
        if (controller.signal.aborted) return
        setLoadErr(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => controller.abort()
  }, [])

  const extraLayouts = useMemo((): SphereLedOverlay[] => {
    const out: SphereLedOverlay[] = []
    for (const p of PRESET_LAYERS) {
      if (!visible[p.id]) continue
      const uv = uvById[p.id]
      if (!uv) continue
      out.push({
        key: p.id,
        uv,
        color: p.color,
        emissive: p.emissive,
      })
    }
    return out
  }, [uvById, visible])

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          LED presets
        </span>
        {PRESET_LAYERS.map((p) => {
          const on = Boolean(visible[p.id])
          return (
            <Button
              key={p.id}
              type="button"
              size="sm"
              variant={on ? 'default' : 'outline'}
              className="h-7 text-xs"
              onClick={() => setVisible((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
            >
              <span
                className="mr-1.5 inline-block size-2 rounded-full"
                style={{ backgroundColor: on ? p.emissive : 'transparent', boxShadow: on ? undefined : `inset 0 0 0 1px ${p.emissive}` }}
                aria-hidden
              />
              {p.label}
            </Button>
          )
        })}
      </div>
      {loadErr ? (
        <p className="mb-2 text-xs text-destructive" role="alert">
          Could not load layout LEDs: {loadErr}
        </p>
      ) : null}
      <LayoutUvSphereCanvas
        uv={null}
        extraLayouts={extraLayouts}
        equirectTextureUrl={textureUrl}
        disabled={false}
        onSphereTap={() => {}}
        pulseHighlights={[]}
        hint="Drag to orbit · toggle presets for LED positions"
      />
    </div>
  )
}
