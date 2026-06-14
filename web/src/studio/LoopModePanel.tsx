import { CalendarClock, Play } from 'lucide-react'
import { LiveMetricsRow } from '@/components/LiveMetricsRow'
import { formatDate } from '@/format'
import { useGlowbeRuntime } from '@/GlowbeRuntimeContext'
import type { RuntimeState, SequenceSummary } from '@/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function LoopModePanel({
  state,
  sequences,
}: {
  state: RuntimeState
  sequences: SequenceSummary[]
}) {
  const { selectSequence, sequenceBusy } = useGlowbeRuntime()
  const playingSequenceId = state.mode === 'loop' ? state.loopSequenceId : null

  return (
    <div className="space-y-6">
      <LiveMetricsRow state={state} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Play className="size-5 text-muted-foreground" aria-hidden />
            Sequences
          </CardTitle>
          <CardDescription>
            {sequences.length === 0
              ? 'No sequences loaded yet.'
              : `${sequences.length} available — pick one to play.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {sequences.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Add sequences using the tooling described in the project README.
            </p>
          ) : (
            <ul className="space-y-3">
              {sequences.map((seq) => (
                <li key={seq.id}>
                  <Card className="border-border/80 shadow-none">
                    <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="space-y-1">
                        <h3 className="font-mono text-base font-semibold tracking-tight">{seq.id}</h3>
                        <p className="font-mono text-xs text-muted-foreground">
                          {seq.frameCount} frame(s) @ {seq.fps} fps · {seq.sourceWidth}×{seq.sourceHeight} ·{' '}
                          {seq.sourceKind}
                        </p>
                        <p className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                          <CalendarClock className="size-3.5" aria-hidden />
                          Created: {formatDate(seq.createdAtUnixSec)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        className="shrink-0"
                        onClick={() => void selectSequence(seq.id)}
                        disabled={sequenceBusy !== null || playingSequenceId === seq.id}
                      >
                        {sequenceBusy === seq.id
                          ? 'Selecting…'
                          : playingSequenceId === seq.id
                            ? 'Now playing'
                            : 'Play'}
                      </Button>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
