import { Gauge } from 'lucide-react'
import type { RuntimeState } from '@/types'
import { formatNumber } from '@/format'
import { Card, CardContent } from '@/components/ui/card'

export function LiveMetricsRow({ state }: { state: RuntimeState }) {
  return (
    <Card className="border-dashed shadow-none">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm">
        <span className="inline-flex items-center gap-2 text-muted-foreground">
          <Gauge className="size-4 shrink-0" aria-hidden />
          <span className="tabular-nums">
            FPS out <span className="font-medium text-foreground">{formatNumber(state.fpsOut)}</span>
          </span>
        </span>
        <span className="text-muted-foreground tabular-nums">
          Stale {state.frameLoopStaleMs} ms · {state.framesSent} frames
        </span>
      </CardContent>
    </Card>
  )
}
