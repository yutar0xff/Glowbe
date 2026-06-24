import { useMemo } from 'react'
import { AlertTriangle, Loader2, OctagonAlert } from 'lucide-react'
import { StatusPill } from '@/components/StatusPill'
import { useGlowbeRuntime } from '@/GlowbeRuntimeContext'
import { StudioPage } from '@/studio/StudioPage'
import { formatNumber } from '@/format'
import { effectiveFpsOut } from '@/lib/metrics'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

export function AppLayout() {
  const { load } = useGlowbeRuntime()
  const state = load.kind === 'ready' ? load.state : undefined
  const health = load.kind === 'ready' || load.kind === 'error' ? load.health : undefined

  const runtimeTone = useMemo(() => {
    if (load.kind === 'error') return 'bad'
    if (!state) return 'muted'
    if (state.frameLoopStaleMs > 1000) return 'bad'
    if (state.layoutMismatch) return 'warn'
    return 'ok'
  }, [load.kind, state])

  const fpsLabel = useMemo(() => {
    if (!state) return null
    return `FPS ${formatNumber(effectiveFpsOut(state))}`
  }, [state])

  return (
    <main className="relative min-h-screen bg-background bg-[radial-gradient(ellipse_80%_50%_at_20%_-10%,oklch(0.55_0.15_195/0.18),transparent),radial-gradient(ellipse_60%_40%_at_80%_0%,oklch(0.55_0.2_300/0.12),transparent)] pb-16 text-foreground">
      <div className="mx-auto w-full max-w-5xl px-4 pt-10 md:px-6 md:pt-14">
        <header className="mb-10 flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <p className="font-mono text-xs font-bold tracking-[0.2em] text-cyan-400 uppercase">Spherical LED display</p>
            <h1 className="font-heading text-4xl font-extrabold tracking-tight md:text-5xl">Glowbe Studio</h1>
            <p className="max-w-xl text-sm text-muted-foreground md:text-base">
              Choose a mode, run your content, and watch health and metrics below.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {fpsLabel ? (
              <StatusPill
                label={fpsLabel}
                tone={state?.mode === 'idle' ? 'muted' : 'fps'}
              />
            ) : null}
            <StatusPill label={health?.ok ? 'health: ok' : 'health: stale/error'} tone={health?.ok ? 'ok' : 'bad'} />
            <StatusPill label={`runtime: ${runtimeTone}`} tone={runtimeTone} />
          </div>
        </header>

        {load.kind === 'loading' ? (
          <div className="flex items-center gap-2 rounded-xl border border-dashed p-6 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" aria-hidden />
            Connecting to runtime…
          </div>
        ) : null}

        {load.kind === 'error' ? (
          <Alert variant="destructive" className="mb-6">
            <OctagonAlert className="size-4" aria-hidden />
            <AlertTitle>Runtime unavailable</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>{load.message}</p>
              <p className="text-sm opacity-90">
                Start the Glowbe runtime (see project README) and reload, or open this page from the host where the
                runtime is running.
              </p>
            </AlertDescription>
          </Alert>
        ) : null}

        {state?.layoutMismatch ? (
          <Alert className="mb-6 border-amber-500/40 bg-amber-500/10 text-amber-50">
            <AlertTriangle className="size-4 text-amber-400" />
            <AlertTitle>Layout mismatch</AlertTitle>
            <AlertDescription className="text-amber-100/90">
              ESP <code className="font-mono text-xs">layout_hash</code> does not match the compiled layout. Re-run{' '}
              <code className="font-mono text-xs">tools/layout-compile.ts</code> and reflash the firmware.
            </AlertDescription>
          </Alert>
        ) : null}

        {load.kind === 'ready' ? <StudioPage /> : null}
      </div>
    </main>
  )
}
