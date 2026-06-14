import { MetricCard } from '../components/MetricCard'
import { formatNumber, formatUptime } from '../format'
import { useGlowbeRuntime } from '../GlowbeRuntimeContext'

export function StatusSection() {
  const { load } = useGlowbeRuntime()
  if (load.kind !== 'ready') return null
  const { state, sequences, fetchedAt } = load
  const playingSequenceId = state.mode === 'loop' ? state.loopSequenceId : null

  return (
    <>
      <section className="grid">
        <MetricCard label="Mode" value={state.mode} hint={playingSequenceId ?? '—'} />
        <MetricCard label="FPS Out" value={formatNumber(state.fpsOut)} hint={`${state.framesSent} frames sent`} />
        <MetricCard label="FPS Rx" value={formatNumber(state.fpsRx)} hint="from ESP STATUS" />
        <MetricCard label="ESP Frames" value={state.espFramesComplete === null ? '-' : String(state.espFramesComplete)} />
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
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Raw state</h2>
          <span>{fetchedAt.toLocaleTimeString()}</span>
        </div>
        <pre>{JSON.stringify(state, null, 2)}</pre>
      </section>
    </>
  )
}
