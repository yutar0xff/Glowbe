import type { MouseEvent } from 'react'
import type { LayoutUvResponse } from '@/types'
import { cn } from '@/lib/utils'
import { equirectDisplayPointerToUv } from '@/lib/layout-uv-geometry'

/** Live map / Loop プレビュー共通: 2:1 equirect 上に各 LED の (u,v) を点で表示（ランタイムの座標系と一致: v は上が 0）。 */
export function LayoutUvSheet({
  uv,
  onEquirectClick,
  disabled,
  className,
}: {
  uv: LayoutUvResponse
  onEquirectClick?: (u: number, v: number) => void
  disabled?: boolean
  className?: string
}) {
  const onClick = (e: MouseEvent<SVGSVGElement>) => {
    if (!onEquirectClick || disabled) return
    const r = e.currentTarget.getBoundingClientRect()
    const { u, v } = equirectDisplayPointerToUv(e.clientX, e.clientY, r)
    onEquirectClick(u, v)
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-border bg-card/40',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      <svg
        className="block h-auto w-full max-w-full touch-manipulation"
        viewBox="0 0 2 1"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="LED layout in equirectangular (u, v)"
        onClick={onClick}
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
      </svg>
    </div>
  )
}
