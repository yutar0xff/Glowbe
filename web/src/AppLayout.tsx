import { useMemo } from 'react'
import { Loader2, OctagonAlert } from 'lucide-react'
import { StatusPill } from '@/components/StatusPill'
import { StudioAppChrome } from '@/components/StudioAppChrome'
import { useGlowbeRuntime } from '@/GlowbeRuntimeContext'
import { StudioPage } from '@/studio/StudioPage'
import { LayoutMismatchAlert } from '@/studio/LayoutMismatchAlert'
import { isLayoutMismatch } from '@/layout-ids'
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
    if (state && isLayoutMismatch(state)) return 'warn'
    return 'ok'
  }, [load.kind, state])

  const fpsValue = useMemo(() => {
    if (!state) return null
    return formatNumber(effectiveFpsOut(state))
  }, [state])

  const pills = (compact: boolean) => (
    <>
      {fpsValue !== null ? <StatusPill label={fpsValue} tone="fps" compact={compact} /> : null}
      <StatusPill
        label={health?.ok ? 'health: ok' : 'health: stale/error'}
        tone={health?.ok ? 'ok' : 'bad'}
        compact={compact}
        showIcon={false}
      />
      <StatusPill label={`runtime: ${runtimeTone}`} tone={runtimeTone} compact={compact} showIcon={false} />
    </>
  )

  return (
    <StudioAppChrome
      eyebrow="Spherical LED display"
      description="Choose a mode, run your content, and watch health and metrics below."
      trailing={pills(false)}
      stickyTrailing={pills(true)}
    >
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

      {state && isLayoutMismatch(state) ? (
        <div className="mb-6">
          <LayoutMismatchAlert
            layoutId={state.layoutId}
            expectedLayoutHash={state.expectedLayoutHash}
            espLayoutHash={state.espLayoutHash}
          />
        </div>
      ) : null}

      {load.kind === 'ready' ? <StudioPage /> : null}
    </StudioAppChrome>
  )
}
