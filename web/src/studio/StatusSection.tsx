import { Braces } from 'lucide-react'
import { MetricCard } from '@/components/MetricCard'
import { formatNumber, formatUptime } from '@/format'
import { effectiveFpsOut, effectiveFpsRx } from '@/lib/metrics'
import { useGlowbeRuntime } from '@/GlowbeRuntimeContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function StatusSection() {
  const { load } = useGlowbeRuntime()
  if (load.kind !== 'ready') return null
  const { state, sequences, fetchedAt } = load
  const playingSequenceId = state.mode === 'loop' ? state.loopSequenceId : null

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <MetricCard label="Mode" value={state.mode} hint={playingSequenceId ?? '—'} />
        <MetricCard label="Target FPS" value={String(state.targetFps)} hint={`out ${formatNumber(effectiveFpsOut(state))}`} />
        <MetricCard label="FPS Rx" value={formatNumber(effectiveFpsRx(state))} hint="device-reported" />
        <MetricCard
          label="ESP Frames"
          value={state.espFramesComplete === null ? '-' : String(state.espFramesComplete)}
        />
        <MetricCard label="ESP RSSI" value={state.espRssi === null ? '-' : `${state.espRssi} dBm`} />
        <MetricCard label="ESP Drops" value={state.espDrops === null ? '-' : String(state.espDrops)} />
        <MetricCard label="ESP Status From" value={state.espStatusAddr ?? '-'} />
        <MetricCard label="Output Target" value={state.outputTargetAddr ?? '-'} />
        <MetricCard
          label="Frame Loop Stale"
          value={`${state.frameLoopStaleMs} ms`}
          hint="health fails above 1000 ms"
        />
        <MetricCard label="LED Count" value={String(state.ledCount)} hint={state.layoutId} />
        <MetricCard label="Uptime" value={formatUptime(state.uptimeSec)} />
        <MetricCard label="Sequences (count)" value={String(sequences.length)} hint="select in Loop mode above" />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Braces className="size-4 text-muted-foreground" aria-hidden />
            Raw state
          </CardTitle>
          <span className="font-mono text-xs text-muted-foreground">{fetchedAt.toLocaleTimeString()}</span>
        </CardHeader>
        <CardContent>
          <pre className="max-h-[min(420px,55vh)] overflow-auto rounded-lg border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {JSON.stringify(state, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}
