import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { LayoutUvResponse } from '@/types'
import { cn } from '@/lib/utils'
import {
  equirectDisplayPointerToUv,
  TAP_HIGHLIGHT_DECAY_MS,
} from '@/lib/layout-uv-geometry'

export type TapUvHighlight = { id: string; u: number; v: number; t0: number; uSphere?: number }

const MAP_TAP_MAX_PX = 18
const MAP_TAP_MAX_MS = 650

/** Live / Loop 共通: 2:1 equirect 上に LED (u,v)。v=0 が上。 */
export function LayoutUvSheet({
  uv,
  onEquirectClick,
  disabled,
  className,
  pulseHighlights,
}: {
  uv: LayoutUvResponse
  onEquirectClick?: (u: number, v: number) => void
  disabled?: boolean
  className?: string
  pulseHighlights?: TapUvHighlight[] | null
}) {
  const [, setAnim] = useState(0)
  const pointersDown = useRef(
    new Map<number, { clientX: number; clientY: number; t: number }>(),
  )

  const highlights = pulseHighlights ?? []
  const highlightsRef = useRef(highlights)
  highlightsRef.current = highlights

  useEffect(() => {
    if (highlights.length === 0) return
    let id = 0
    const loop = () => {
      setAnim((n) => n + 1)
      const now = performance.now()
      const any = highlightsRef.current.some((h) => now - h.t0 < TAP_HIGHLIGHT_DECAY_MS)
      if (any) id = requestAnimationFrame(loop)
    }
    id = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(id)
  }, [highlights.length, highlights.map((h) => h.id).join()])

  const flushTap = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!onEquirectClick || disabled) return
    const start = pointersDown.current.get(e.pointerId)
    pointersDown.current.delete(e.pointerId)
    if (!start) return
    const dt = performance.now() - start.t
    const dist = Math.hypot(e.clientX - start.clientX, e.clientY - start.clientY)
    if (dist > MAP_TAP_MAX_PX || dt > MAP_TAP_MAX_MS) return
    const r = e.currentTarget.getBoundingClientRect()
    const { u, v } = equirectDisplayPointerToUv(e.clientX, e.clientY, r)
    onEquirectClick(u, v)
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-border bg-card/40 select-none',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
      onContextMenu={(e) => e.preventDefault()}
    >
      <svg
        className="aspect-[2/1] block h-auto w-full max-w-full touch-manipulation"
        onContextMenu={(e) => e.preventDefault()}
        viewBox="0 0 2 1"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="LED layout in equirectangular (u, v)"
        onPointerDown={(e) => {
          if (disabled || !onEquirectClick) return
          e.currentTarget.setPointerCapture(e.pointerId)
          pointersDown.current.set(e.pointerId, {
            clientX: e.clientX,
            clientY: e.clientY,
            t: performance.now(),
          })
        }}
        onPointerUp={(e) => {
          flushTap(e)
        }}
        onPointerCancel={(e) => {
          pointersDown.current.delete(e.pointerId)
        }}
      >
        <rect x={0} y={0} width={2} height={1} className="fill-muted/40" />
        {uv.leds.map((led) => (
          <circle
            key={led.i}
            cx={led.u * 2}
            cy={led.v}
            r={0.028}
            className="fill-cyan-400/85 stroke-background/50 stroke-[0.006]"
          />
        ))}
        {highlights.map((h) => {
          const hiPhase = Math.max(0, 1 - (performance.now() - h.t0) / TAP_HIGHLIGHT_DECAY_MS)
          if (hiPhase <= 0) return null
          return (
            <g key={h.id} pointerEvents="none">
              <circle
                cx={h.u * 2}
                cy={h.v}
                r={0.07 + 0.05 * (1 - hiPhase)}
                fill="none"
                stroke="rgba(253,224,71,0.9)"
                strokeWidth={0.012 * hiPhase}
                opacity={0.15 + 0.75 * hiPhase}
              />
              <circle
                cx={h.u * 2}
                cy={h.v}
                r={0.022}
                fill="rgba(253,224,71,0.55)"
                opacity={0.2 + 0.8 * hiPhase}
              />
            </g>
          )
        })}
      </svg>
    </div>
  )
}
