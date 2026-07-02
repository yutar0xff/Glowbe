import { useState } from 'react'
import { Loader2, Smile, Wind } from 'lucide-react'
import { LayoutUvSheet } from '@/components/LayoutUvMap'
import { LayoutUvSphereCanvas } from '@/components/LayoutUvSphereCanvas'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useGlowbeRuntime } from '@/GlowbeRuntimeContext'
import { useGlowbeStandaloneLedPreview } from '@/hooks/use-glowbe-standalone-led-preview'
import { useLayoutUv } from '@/hooks/use-layout-uv'
import { DEFAULT_MATE_TRANSITION_MS, MATE_LAYOUT_ID } from '@/mate/constants'
import type { MateBreathingParams } from '@/mate/types'
import { useMatePresets } from '@/mate/useMatePresets'
import type { RuntimeState } from '@/types'

export function MateModePanel({ state }: { state: RuntimeState }) {
  const { activeDeviceId, setMateExpression, setMateBreathing, mateExpressionBusy, mateBreathingBusy } =
    useGlowbeRuntime()
  const mateSupported = state.layoutId === MATE_LAYOUT_ID

  const [transitionMs, setTransitionMs] = useState(DEFAULT_MATE_TRANSITION_MS)
  const {
    presets,
    activePresetId,
    setActivePresetId,
    loading: presetsLoading,
    error: presetsErr,
    breathing,
    setBreathing,
  } = useMatePresets(activeDeviceId, mateSupported)

  const { uv, uvLoading, uvError } = useLayoutUv(state.layoutId, state.ledCount)
  const previewEnabled = mateSupported && state.mode === 'mate'
  const { liveRgbBuf, liveRgbRevision } = useGlowbeStandaloneLedPreview(
    previewEnabled,
    state.ledCount,
    activeDeviceId,
  )

  const onPickPreset = (presetId: string) => {
    void (async () => {
      try {
        await setMateExpression(presetId, transitionMs)
        setActivePresetId(presetId)
      } catch {
        /* surfaced via load error state in provider */
      }
    })()
  }

  const applyBreathing = (next: MateBreathingParams) => {
    setBreathing(next)
    void (async () => {
      try {
        await setMateBreathing(next)
      } catch {
        /* surfaced via load error state in provider */
      }
    })()
  }

  if (!mateSupported) {
    return (
      <Alert>
        <Smile className="size-4" aria-hidden />
        <AlertTitle>Mate mode needs the product layout</AlertTitle>
        <AlertDescription>
          Switch this device to <span className="font-mono">{MATE_LAYOUT_ID}</span> in Device settings. The
          prototype layout does not have enough LEDs for face rendering.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Smile className="size-5 text-muted-foreground" aria-hidden />
            Expression
          </CardTitle>
          <CardDescription>
            Pick a face preset on the sphere. Transitions morph between expressions on the device (server
            authority).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <div className="flex justify-between gap-2">
              <Label className="text-xs font-semibold">Transition</Label>
              <span className="text-xs text-muted-foreground tabular-nums">
                {transitionMs <= 0 ? 'Instant' : `${transitionMs} ms`}
              </span>
            </div>
            <Slider
              min={0}
              max={1200}
              step={20}
              value={[transitionMs]}
              onValueChange={(v) => setTransitionMs(v[0]!)}
              disabled={mateExpressionBusy !== null}
            />
          </div>

          {presetsLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Loading presets…
            </p>
          ) : null}

          {presetsErr ? (
            <p className="text-sm text-destructive" role="alert">
              {presetsErr}
            </p>
          ) : null}

          {!presetsLoading && presets.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {presets.map((p) => {
                const active = activePresetId === p.id
                const busy = mateExpressionBusy === p.id
                return (
                  <Button
                    key={p.id}
                    type="button"
                    variant={active ? 'default' : 'outline'}
                    className="h-auto min-h-11 flex-col items-start gap-0.5 px-3 py-2 text-left"
                    disabled={mateExpressionBusy !== null}
                    onClick={() => onPickPreset(p.id)}
                  >
                    <span className="flex w-full items-center gap-2 text-sm font-medium">
                      {busy ? <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden /> : null}
                      {p.displayName}
                    </span>
                    <span className="text-[10px] font-normal text-muted-foreground">
                      {p.id} · {p.partCount} parts · {p.source}
                    </span>
                  </Button>
                )
              })}
            </div>
          ) : null}

          {state.mode !== 'mate' ? (
            <p className="text-xs text-muted-foreground">
              Output is not in mate mode yet — selecting a preset will switch automatically.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Wind className="size-5 text-muted-foreground" aria-hidden />
            Breathing
          </CardTitle>
          <CardDescription>
            Fixed-strength brightness bob and vertical sway. Breath rate follows the active preset.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="mate-breathing-enabled" className="text-sm">
              Enabled
            </Label>
            <Switch
              id="mate-breathing-enabled"
              checked={breathing.enabled}
              disabled={mateBreathingBusy}
              onCheckedChange={(enabled) => applyBreathing({ ...breathing, enabled })}
            />
          </div>
          {activePresetId ? (
            <p className="text-xs text-muted-foreground">
              Period:{' '}
              <span className="font-mono tabular-nums">
                {presets.find((p) => p.id === activePresetId)?.breathingPeriodMs ?? '—'} ms
              </span>{' '}
              (from preset)
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Live preview</CardTitle>
          <CardDescription>
            Subscribed to runtime preview frames while mate mode is active ({state.targetFps} fps target on
            device).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {uvLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Loading layout…
            </p>
          ) : null}
          {uvError ? (
            <p className="text-sm text-destructive" role="alert">
              {uvError}
            </p>
          ) : null}
          {uv && !uvLoading ? (
            <div className="flex flex-col gap-8">
              <div className="min-w-0 space-y-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Equirect (2D)
                </p>
                <LayoutUvSheet
                  uv={uv}
                  disabled
                  liveLedRgb={liveRgbBuf.current}
                  liveLedRevision={liveRgbRevision}
                />
              </div>
              <div className="min-w-0 space-y-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Sphere (Three.js)
                </p>
                <LayoutUvSphereCanvas
                  uv={uv}
                  disabled={false}
                  pulseHighlights={[]}
                  liveLedRgb={liveRgbBuf.current ?? undefined}
                  onSphereTap={() => {}}
                />
              </div>
            </div>
          ) : null}
          {!previewEnabled ? (
            <p className="text-xs text-muted-foreground">
              Preview stream starts when mate mode is the active output mode.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
