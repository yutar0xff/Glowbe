import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, OctagonAlert } from 'lucide-react'
import { StatusPill } from '@/components/StatusPill'
import { useGlowbeRuntime } from '@/GlowbeRuntimeContext'
import { StudioPage } from '@/studio/StudioPage'
import { LayoutMismatchAlert } from '@/studio/LayoutMismatchAlert'
import { isLayoutMismatch } from '@/layout-ids'
import { formatNumber } from '@/format'
import { effectiveFpsOut } from '@/lib/metrics'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

export function AppLayout() {
  const { load } = useGlowbeRuntime()
  const state = load.kind === 'ready' ? load.state : undefined
  const health = load.kind === 'ready' || load.kind === 'error' ? load.health : undefined

  const titleRef = useRef<HTMLHeadingElement>(null)
  const [stuck, setStuck] = useState(false)

  useEffect(() => {
    const el = titleRef.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), {
      threshold: 0,
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])

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
    <main className="relative min-h-screen bg-background bg-[radial-gradient(ellipse_80%_50%_at_20%_-10%,oklch(0.55_0.15_195/0.18),transparent),radial-gradient(ellipse_60%_40%_at_80%_0%,oklch(0.55_0.2_300/0.12),transparent)] pb-16 text-foreground">
      <div
        className={cn(
          'fixed inset-x-0 top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md transition-[transform,opacity] duration-300 ease-out',
          stuck ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-full opacity-0',
        )}
        aria-hidden={!stuck}
      >
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-4 md:px-6">
          <span
            className={cn(
              'shrink-0 font-heading text-lg font-extrabold tracking-tight whitespace-nowrap transition-all duration-300 ease-out',
              stuck ? 'translate-y-0 opacity-100' : 'translate-y-1.5 opacity-0',
            )}
          >
            Glowbe Studio
          </span>
          <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-hidden">{pills(true)}</div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-5xl px-4 pt-10 md:px-6 md:pt-14">
        <header className="mb-10 flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <p className="font-mono text-xs font-bold tracking-[0.2em] text-cyan-400 uppercase">Spherical LED display</p>
            <h1 ref={titleRef} className="font-heading text-4xl font-extrabold tracking-tight md:text-5xl">
              Glowbe Studio
            </h1>
            <p className="max-w-xl text-sm text-muted-foreground md:text-base">
              Choose a mode, run your content, and watch health and metrics below.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">{pills(false)}</div>
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
      </div>
    </main>
  )
}
