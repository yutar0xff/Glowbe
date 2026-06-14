import { Loader2 } from 'lucide-react'
import { useLayoutUv } from '@/hooks/use-layout-uv'
import { LayoutUvSheet } from '@/components/LayoutUvMap'

/** Loop 用: `useLayoutUv` + 2:1 散布図（Live map と同一 SVG 座標系）。 */
export function LayoutUvStudioSection({
  layoutId,
  ledCount,
}: {
  layoutId: string
  ledCount: number
}) {
  const { uv, uvError, uvLoading } = useLayoutUv(layoutId, ledCount)

  return (
    <div className="space-y-5">
      {uvLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading layout map…
        </p>
      ) : null}
      {uvError ? (
        <p className="max-w-full break-words text-sm text-destructive" role="alert">
          {uvError}
        </p>
      ) : null}

      {uv && !uvLoading ? (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground">
            Equirect (u, v) — same projection as Live map
          </h4>
          <p className="text-xs text-muted-foreground">
            v = 0 at the top (north). Matches runtime sampling and interactive taps.
          </p>
          <LayoutUvSheet uv={uv} />
        </div>
      ) : null}
    </div>
  )
}
