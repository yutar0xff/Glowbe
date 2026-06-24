import type { RuntimeState } from '@/types'
import { formatNumber } from '@/format'
import { effectiveFpsOut } from '@/lib/metrics'
import { Card, CardContent } from '@/components/ui/card'

export function LiveMetricsRow({ state }: { state: RuntimeState }) {
  const fpsOut = effectiveFpsOut(state)
  return (
    <Card className="border-dashed shadow-none">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm">
        <span className="inline-flex items-center gap-2 text-muted-foreground tabular-nums">
          FPS out <span className="font-medium text-foreground">{formatNumber(fpsOut)}</span>
        </span>
        <span className="text-muted-foreground tabular-nums">
          Stale {state.frameLoopStaleMs} ms · {state.framesSent} frames
        </span>
      </CardContent>
    </Card>
  )
}
