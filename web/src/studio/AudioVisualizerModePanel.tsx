import { useCallback, useEffect, useState } from 'react'
import { AudioLines, Loader2 } from 'lucide-react'
import {
  fetchAudioInputs,
  fetchAudioVisualizer,
  postAudioInput,
  postAudioVisualizer,
} from '@/api'
import {
  ATTACK_MAX,
  ATTACK_MIN,
  AUDIO_PALETTES,
  AUDIO_PATTERNS,
  DEFAULT_AUDIO_VISUALIZER,
  INTENSITY_MAX,
  INTENSITY_MIN,
  MOTION_MAX,
  MOTION_MIN,
  PERSISTENCE_MAX,
  PERSISTENCE_MIN,
  GAMMA_MAX,
  GAMMA_MIN,
  RELEASE_MAX,
  RELEASE_MIN,
} from '@/audio/constants'
import {
  isTabIngestCapturing,
  startTabIngest,
  stopTabIngest,
  subscribeTabIngest,
  tabIngestSupported,
} from '@/audio/tabIngestSession'
import type {
  AudioInputsResponse,
  AudioVisualizerConfig,
  AudioVisualizerPalette,
  AudioVisualizerPattern,
  AudioVisualizerSnapshot,
} from '@/audio/types'
import { LayoutUvSheet } from '@/components/LayoutUvMap'
import { LayoutUvSphereCanvas } from '@/components/LayoutUvSphereCanvas'
import { NumberSliderRow } from '@/components/NumberSliderRow'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useGlowbeRuntime } from '@/GlowbeRuntimeContext'
import { useGlowbeStandaloneLedPreview } from '@/hooks/use-glowbe-standalone-led-preview'
import { useLayoutUv } from '@/hooks/use-layout-uv'
import type { RuntimeState } from '@/types'
import { ModeResetBar } from './ModeResetBar'

const ONSET_BADGE_THRESHOLD = 0.2

function LevelMeter({ label, value }: { label: string; value: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <div className="space-y-1">
      <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>{label}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded bg-muted">
        <div className="h-full bg-primary transition-[width] duration-75" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function BandMeter({ bands }: { bands: number[] }) {
  return (
    <div className="flex h-16 items-end gap-0.5">
      {bands.map((b, i) => {
        const h = Math.round(Math.min(1, Math.max(0, b)) * 100)
        return (
          <div
            key={i}
            className="min-w-0 flex-1 rounded-t bg-primary/80"
            style={{ height: `${Math.max(4, h)}%` }}
            title={`${(b * 100).toFixed(0)}%`}
          />
        )
      })}
    </div>
  )
}

function snapshotToConfig(s: AudioVisualizerSnapshot): AudioVisualizerConfig {
  const pattern = (AUDIO_PATTERNS.find((p) => p.id === s.pattern)?.id ??
    DEFAULT_AUDIO_VISUALIZER.pattern) as AudioVisualizerPattern
  const palette = (AUDIO_PALETTES.find((p) => p.id === s.palette)?.id ??
    DEFAULT_AUDIO_VISUALIZER.palette) as AudioVisualizerPalette
  return {
    pattern,
    palette,
    intensity: s.intensity,
    motion: s.motion,
    persistence: s.persistence,
    gamma: s.gamma,
    attack: s.attack,
    release: s.release,
  }
}

export function AudioVisualizerModePanel({ state }: { state: RuntimeState }) {
  const { activeDeviceId, setMode, modeBusy } = useGlowbeRuntime()
  const { uv, uvLoading, uvError } = useLayoutUv(state.layoutId, state.ledCount)
  const previewEnabled = state.mode === 'audio-visualizer'
  const { liveRgbBuf, liveRgbRevision } = useGlowbeStandaloneLedPreview(
    previewEnabled,
    state.ledCount,
    activeDeviceId,
  )

  const [inputs, setInputs] = useState<AudioInputsResponse | null>(null)
  const [tabCapturing, setTabCapturing] = useState(() => isTabIngestCapturing())
  const [snap, setSnap] = useState<AudioVisualizerSnapshot | null>(null)
  const [config, setConfig] = useState<AudioVisualizerConfig>(DEFAULT_AUDIO_VISUALIZER)
  const [busy, setBusy] = useState(false)
  const [resetBusy, setResetBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => subscribeTabIngest(() => setTabCapturing(isTabIngestCapturing())), [])

  const reloadInputs = useCallback(async () => {
    try {
      const body = await fetchAudioInputs(new AbortController().signal)
      setInputs(body)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const reloadViz = useCallback(async () => {
    try {
      const body = await fetchAudioVisualizer(new AbortController().signal, activeDeviceId)
      setSnap(body)
      setConfig(snapshotToConfig(body))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [activeDeviceId])

  useEffect(() => {
    void reloadInputs()
    void reloadViz()
  }, [reloadInputs, reloadViz])

  useEffect(() => {
    const id = window.setInterval(() => {
      void (async () => {
        try {
          const body = await fetchAudioVisualizer(new AbortController().signal, activeDeviceId)
          setSnap(body)
        } catch {
          /* ignore poll errors */
        }
      })()
    }, 100)
    return () => window.clearInterval(id)
  }, [activeDeviceId])

  const commitConfig = async (patch: Partial<AudioVisualizerConfig>) => {
    setBusy(true)
    setError(null)
    const next = { ...config, ...patch }
    setConfig(next)
    try {
      await setMode('audio-visualizer')
      const body = await postAudioVisualizer(new AbortController().signal, activeDeviceId, patch)
      setSnap(body)
      setConfig(snapshotToConfig(body))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const selectInput = async (inputId: string | null) => {
    setBusy(true)
    setError(null)
    try {
      const body = await postAudioInput(new AbortController().signal, inputId)
      setInputs(body)
      await setMode('audio-visualizer')
      await reloadViz()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const startTabCapture = async () => {
    setBusy(true)
    setError(null)
    try {
      await setMode('audio-visualizer')
      await startTabIngest()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const resetToDefaults = async () => {
    setResetBusy(true)
    setConfig(DEFAULT_AUDIO_VISUALIZER)
    try {
      await setMode('audio-visualizer')
      const body = await postAudioVisualizer(
        new AbortController().signal,
        activeDeviceId,
        DEFAULT_AUDIO_VISUALIZER,
      )
      setSnap(body)
      setConfig(snapshotToConfig(body))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setResetBusy(false)
    }
  }

  const disabled = busy || resetBusy || modeBusy !== null
  const tabOk = tabIngestSupported()
  const platformOk = inputs?.platform.available ?? false

  return (
    <div className="space-y-6">
      <ModeResetBar onReset={resetToDefaults} busy={resetBusy} disabled={disabled && !resetBusy} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <AudioLines className="size-5 text-muted-foreground" aria-hidden />
            Audio Visualizer
          </CardTitle>
          <CardDescription>
            Capture another browser tab&apos;s audio (desktop) or a host PipeWire mic, and drive living
            spherical scenes on Glowbe.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-3">
            <Label className="font-mono text-xs font-semibold">Tab audio capture</Label>
            {!tabOk ? (
              <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                Tab audio capture needs a desktop browser with display-media support (Chrome
                recommended). On phones, use a host mic below if available.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Share a tab (e.g. YouTube Music) and enable tab audio. Glowbe analyzes only — it does
                not play a second copy. Capture continues across device switches and while Studio is
                in the background (Chrome may still stop if the share indicator is dismissed).
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled || !tabOk || tabCapturing}
                onClick={() => void startTabCapture()}
              >
                {tabCapturing ? 'Capturing…' : 'Capture tab audio'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled || !tabCapturing}
                onClick={stopTabIngest}
              >
                Stop capture
              </Button>
            </div>
            {tabCapturing ? (
              <p className="font-mono text-xs text-muted-foreground">
                Sending tab audio to runtime for visualization.
              </p>
            ) : null}
          </div>

          <div className="space-y-2 border-t border-border pt-4">
            <Label className="font-mono text-xs font-semibold">Host mic (optional)</Label>
            {!platformOk && inputs ? (
              <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                Host PipeWire unavailable
                {inputs.platform.reason ? `: ${inputs.platform.reason}` : '.'}
              </p>
            ) : null}
            <Select
              value={inputs?.selectedInputId ?? '__none__'}
              disabled={disabled || !platformOk || tabCapturing}
              onValueChange={(v) => void selectInput(v === '__none__' ? null : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select input…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {(inputs?.inputs ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              PipeWire capture on the runtime host. Unavailable while tab ingest is active.
              {snap?.connected ? ` · ${snap.inputName ?? snap.inputId}` : ''}
              {snap?.beat ? ' · beat' : ''}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scene</CardTitle>
          <CardDescription>Spherical scene, palette, and motion controls.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label className="font-mono text-xs font-semibold">Scene</Label>
            <Select
              value={config.pattern}
              disabled={disabled}
              onValueChange={(v) => void commitConfig({ pattern: v as AudioVisualizerPattern })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUDIO_PATTERNS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {AUDIO_PATTERNS.find((p) => p.id === config.pattern)?.description}
            </p>
          </div>

          <div className="space-y-2">
            <Label className="font-mono text-xs font-semibold">Palette</Label>
            <Select
              value={config.palette}
              disabled={disabled}
              onValueChange={(v) => void commitConfig({ palette: v as AudioVisualizerPalette })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUDIO_PALETTES.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <NumberSliderRow
              id="av-intensity"
              label="Intensity"
              min={INTENSITY_MIN}
              max={INTENSITY_MAX}
              step={0.05}
              value={config.intensity}
              disabled={disabled}
              onCommit={(v) => void commitConfig({ intensity: v })}
            />
            <NumberSliderRow
              id="av-motion"
              label="Motion"
              min={MOTION_MIN}
              max={MOTION_MAX}
              step={0.05}
              value={config.motion}
              disabled={disabled}
              onCommit={(v) => void commitConfig({ motion: v })}
            />
            <NumberSliderRow
              id="av-persistence"
              label="Persistence"
              min={PERSISTENCE_MIN}
              max={PERSISTENCE_MAX}
              step={0.05}
              value={config.persistence}
              disabled={disabled}
              onCommit={(v) => void commitConfig({ persistence: v })}
            />
            <NumberSliderRow
              id="av-gamma"
              label="Gamma"
              min={GAMMA_MIN}
              max={GAMMA_MAX}
              step={0.05}
              value={config.gamma}
              disabled={disabled}
              onCommit={(v) => void commitConfig({ gamma: v })}
            />
          </div>

          <details className="rounded-md border border-border/60 p-3">
            <summary className="cursor-pointer font-mono text-xs font-semibold">Advanced</summary>
            <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
              <NumberSliderRow
                id="av-attack"
                label="Attack"
                min={ATTACK_MIN}
                max={ATTACK_MAX}
                step={0.01}
                value={config.attack}
                disabled={disabled}
                onCommit={(v) => void commitConfig({ attack: v })}
              />
              <NumberSliderRow
                id="av-release"
                label="Release"
                min={RELEASE_MIN}
                max={RELEASE_MAX}
                step={0.01}
                value={config.release}
                disabled={disabled}
                onCommit={(v) => void commitConfig({ release: v })}
              />
            </div>
          </details>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {snap?.error ? (
            <p className="text-sm text-destructive" role="alert">
              Capture: {snap.error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded bg-muted px-2 py-0.5 font-mono">
              {AUDIO_PATTERNS.find((p) => p.id === config.pattern)?.label ?? config.pattern}
            </span>
            {snap?.onset && snap.onset > ONSET_BADGE_THRESHOLD ? (
              <span className="rounded bg-primary/15 px-2 py-0.5 font-mono text-primary">onset</span>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <LevelMeter label="Low" value={snap?.low ?? 0} />
            <LevelMeter label="Mid" value={snap?.mid ?? 0} />
            <LevelMeter label="High" value={snap?.high ?? 0} />
            <LevelMeter label="Centroid" value={snap?.centroid ?? 0} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <LevelMeter label="RMS" value={snap?.rms ?? 0} />
            <LevelMeter label="Onset" value={snap?.onset ?? 0} />
            <LevelMeter label="Flux" value={snap?.flux ?? 0} />
          </div>
          <div className="space-y-1">
            <p className="font-mono text-[10px] text-muted-foreground">Spectrum</p>
            <BandMeter bands={snap?.bands ?? []} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preview</CardTitle>
          <CardDescription>Live LED preview (pre-tone). Sphere is primary; equirect is optional.</CardDescription>
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
              <details className="min-w-0 space-y-2">
                <summary className="cursor-pointer text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Equirect (2D)
                </summary>
                <div className="pt-2">
                  <LayoutUvSheet
                    uv={uv}
                    disabled
                    liveLedRgb={liveRgbBuf.current}
                    liveLedRevision={liveRgbRevision}
                  />
                </div>
              </details>
            </div>
          ) : null}
          {!previewEnabled ? (
            <p className="text-xs text-muted-foreground">
              Switch to Audio Visualizer mode to stream the live LED preview.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
