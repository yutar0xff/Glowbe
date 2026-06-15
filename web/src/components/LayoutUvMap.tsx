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

/** ViewBox 2×1 上の LED ドット半径（過密レイアウトでも重なりにくい程度） */
const LED_CIRCLE_R = 0.016
const LED_STROKE_CLASS = 'stroke-background/45 stroke-[0.0035]'

/** Live / Loop 共通: 2:1 equirect 上に LED (u,v)。v=0 が上。 */
export function LayoutUvSheet({
  uv,
  onEquirectClick,
  disabled,
  className,
  pulseHighlights,
  liveLedRgb,
  liveLedRevision = 0,
}: {
  uv: LayoutUvResponse
  onEquirectClick?: (u: number, v: number) => void
  disabled?: boolean
  className?: string
  pulseHighlights?: TapUvHighlight[] | null
  /** LED 順の RGB（`ledCount * 3`）。指定時は各点の色に使う。 */
  liveLedRgb?: Uint8Array | null
  /** `liveLedRgb` の内容更新のたびに増やすと再描画される。 */
  liveLedRevision?: number
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
      data-live-led-rev={liveLedRevision}
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
        {uv.leds.map((led) => {
          const o = led.i * 3
          const rgb = liveLedRgb
          const hasLive =
            rgb != null && rgb.length >= o + 3 && rgb.length === uv.leds.length * 3
          return (
            <circle
              key={led.i}
              cx={led.u * 2}
              cy={led.v}
              r={LED_CIRCLE_R}
              fill={
                hasLive
                  ? `rgb(${rgb[o]!},${rgb[o + 1]!},${rgb[o + 2]!})`
                  : undefined
              }
              className={
                hasLive ? LED_STROKE_CLASS : cn('fill-cyan-400/85', LED_STROKE_CLASS)
              }
            />
          )
        })}
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
                r={LED_CIRCLE_R * 0.9}
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
