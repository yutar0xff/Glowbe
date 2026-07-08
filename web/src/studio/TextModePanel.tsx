import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Loader2, Type } from 'lucide-react'
import { LayoutUvSheet } from '@/components/LayoutUvMap'
import { LayoutUvSphereCanvas } from '@/components/LayoutUvSphereCanvas'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { useGlowbeRuntime } from '@/GlowbeRuntimeContext'
import { useGlowbeStandaloneLedPreview } from '@/hooks/use-glowbe-standalone-led-preview'
import { useLayoutUv } from '@/hooks/use-layout-uv'
import {
  DEFAULT_TEXT_PARAMS,
  FADE_ANGLE_DEG_MAX,
  FADE_ANGLE_DEG_MIN,
  LOOP_INTERVAL_SEC_MAX,
  LOOP_INTERVAL_SEC_MIN,
  PITCH_DEG_MAX,
  PITCH_DEG_MIN,
  ROLL_DEG_MAX,
  ROLL_DEG_MIN,
  SPEED_DEG_PER_SEC_MAX,
  SPEED_DEG_PER_SEC_MIN,
  TEXT_CONTENT_MAX,
  TEXT_SIZE_DEG_MAX,
  TEXT_SIZE_DEG_MIN,
  THICKNESS_MAX,
  THICKNESS_MIN,
  YAW_DEG_MAX,
  YAW_DEG_MIN,
} from '@/text/constants'
import type { TextModeParams } from '@/text/types'
import { useTextConfig } from '@/text/useTextConfig'
import type { RuntimeState } from '@/types'
import { ModeResetBar } from './ModeResetBar'

function commitOnEnter(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === 'Enter') {
    e.preventDefault()
    e.currentTarget.blur()
  }
}

function NumberSliderRow({
  id,
  label,
  unit,
  min,
  max,
  step,
  value,
  disabled,
  onCommit,
}: {
  id: string
  label: string
  unit?: string
  min: number
  max: number
  step: number
  value: number
  disabled?: boolean
  onCommit: (v: number) => void
}) {
  const decimals = step < 1 ? 1 : 0
  const fmt = (n: number) => Number(n.toFixed(decimals))
  const dragging = useRef(false)
  const [display, setDisplay] = useState(value)
  const [text, setText] = useState(String(value))

  useEffect(() => {
    if (!dragging.current) {
      setDisplay(value)
      setText(String(value))
    }
  }, [value])

  const clamp = (n: number) => Math.min(max, Math.max(min, n))

  const commitText = () => {
    const n = Number.parseFloat(text)
    if (!Number.isFinite(n)) {
      setText(String(value))
      return
    }
    const c = fmt(clamp(n))
    setDisplay(c)
    setText(String(c))
    if (c !== value) onCommit(c)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="font-mono text-xs font-semibold">
          {label}
        </Label>
        <div className="relative w-24">
          <Input
            id={`${id}-text`}
            inputMode="decimal"
            className="h-7 pr-6 text-right font-mono text-xs tabular-nums"
            value={text}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            onBlur={commitText}
            onKeyDown={commitOnEnter}
          />
          {unit ? (
            <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center font-mono text-xs text-muted-foreground">
              {unit}
            </span>
          ) : null}
        </div>
      </div>
      <Slider
        id={id}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={[clamp(display)]}
        onValueChange={(v) => {
          dragging.current = true
          const d = fmt(v[0]!)
          setDisplay(d)
          setText(String(d))
        }}
        onValueCommit={(v) => {
          dragging.current = false
          const c = fmt(clamp(v[0]!))
          setDisplay(c)
          setText(String(c))
          if (c !== value) onCommit(c)
        }}
      />
    </div>
  )
}

function ColorRow({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string
  label: string
  value: string
  disabled?: boolean
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="font-mono text-xs font-semibold">
        {label}
      </Label>
      <input
        id={id}
        type="color"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent disabled:opacity-40"
      />
    </div>
  )
}

export function TextModePanel({ state }: { state: RuntimeState }) {
  const { activeDeviceId, setTextConfig, textConfigBusy } = useGlowbeRuntime()
  const { params, setParams, loading, error } = useTextConfig(activeDeviceId)
  const [contentText, setContentText] = useState(params.content)
  const [resetBusy, setResetBusy] = useState(false)

  useEffect(() => {
    setContentText(params.content)
  }, [params.content])

  const { uv, uvLoading, uvError } = useLayoutUv(state.layoutId, state.ledCount)
  const previewEnabled = state.mode === 'text'
  const { liveRgbBuf, liveRgbRevision } = useGlowbeStandaloneLedPreview(
    previewEnabled,
    state.ledCount,
    activeDeviceId,
  )

  const commit = (patch: Partial<TextModeParams>) => {
    setParams((prev) => ({ ...prev, ...patch }))
    void (async () => {
      try {
        await setTextConfig(patch)
      } catch {
        /* surfaced via load error state in provider */
      }
    })()
  }

  const commitContent = () => {
    const next = contentText.slice(0, TEXT_CONTENT_MAX)
    if (next !== params.content) commit({ content: next })
  }

  const resetToDefaults = async () => {
    setResetBusy(true)
    setParams(DEFAULT_TEXT_PARAMS)
    setContentText(DEFAULT_TEXT_PARAMS.content)
    try {
      await setTextConfig(DEFAULT_TEXT_PARAMS)
    } catch {
      /* surfaced via load error state in provider */
    } finally {
      setResetBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <ModeResetBar
        onReset={resetToDefaults}
        busy={resetBusy}
        disabled={(textConfigBusy && !resetBusy) || loading}
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Type className="size-5 text-muted-foreground" aria-hidden />
            Text
          </CardTitle>
          <CardDescription>
            Flow any word or sentence around the sphere. Text appears and disappears behind the device front,
            fading to the background color near the back.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="text-content" className="font-mono text-xs font-semibold">
              Content
            </Label>
            <Input
              id="text-content"
              value={contentText}
              maxLength={TEXT_CONTENT_MAX}
              placeholder="Type a word or sentence…"
              disabled={textConfigBusy}
              onChange={(e) => setContentText(e.target.value)}
              onBlur={commitContent}
              onKeyDown={commitOnEnter}
            />
          </div>

          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Loading text config…
            </p>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <NumberSliderRow
              id="text-size"
              label="Text size"
              unit="°"
              min={TEXT_SIZE_DEG_MIN}
              max={TEXT_SIZE_DEG_MAX}
              step={1}
              value={params.textSizeDeg}
              disabled={textConfigBusy}
              onCommit={(v) => commit({ textSizeDeg: v })}
            />
            <NumberSliderRow
              id="text-speed"
              label="Flow speed"
              unit="°/s"
              min={SPEED_DEG_PER_SEC_MIN}
              max={SPEED_DEG_PER_SEC_MAX}
              step={5}
              value={params.speedDegPerSec}
              disabled={textConfigBusy}
              onCommit={(v) => commit({ speedDegPerSec: v })}
            />
            <NumberSliderRow
              id="text-yaw"
              label="Band center yaw"
              unit="°"
              min={YAW_DEG_MIN}
              max={YAW_DEG_MAX}
              step={1}
              value={params.yawDeg}
              disabled={textConfigBusy}
              onCommit={(v) => commit({ yawDeg: v })}
            />
            <NumberSliderRow
              id="text-pitch"
              label="Band center pitch"
              unit="°"
              min={PITCH_DEG_MIN}
              max={PITCH_DEG_MAX}
              step={1}
              value={params.pitchDeg}
              disabled={textConfigBusy}
              onCommit={(v) => commit({ pitchDeg: v })}
            />
            <NumberSliderRow
              id="text-roll"
              label="Band roll"
              unit="°"
              min={ROLL_DEG_MIN}
              max={ROLL_DEG_MAX}
              step={1}
              value={params.rollDeg}
              disabled={textConfigBusy}
              onCommit={(v) => commit({ rollDeg: v })}
            />
            <NumberSliderRow
              id="text-thickness"
              label="Thickness"
              min={THICKNESS_MIN}
              max={THICKNESS_MAX}
              step={0.1}
              value={params.thickness}
              disabled={textConfigBusy}
              onCommit={(v) => commit({ thickness: v })}
            />
            <NumberSliderRow
              id="text-fade-start"
              label="Fade start"
              unit="°"
              min={FADE_ANGLE_DEG_MIN}
              max={FADE_ANGLE_DEG_MAX}
              step={1}
              value={params.fadeStartDeg}
              disabled={textConfigBusy}
              onCommit={(v) => commit({ fadeStartDeg: v })}
            />
            <NumberSliderRow
              id="text-fade-end"
              label="Fade end"
              unit="°"
              min={FADE_ANGLE_DEG_MIN}
              max={FADE_ANGLE_DEG_MAX}
              step={1}
              value={params.fadeEndDeg}
              disabled={textConfigBusy}
              onCommit={(v) => commit({ fadeEndDeg: v })}
            />
            <NumberSliderRow
              id="text-loop-interval"
              label="Loop interval"
              unit="s"
              min={LOOP_INTERVAL_SEC_MIN}
              max={LOOP_INTERVAL_SEC_MAX}
              step={0.5}
              value={params.loopIntervalSec}
              disabled={textConfigBusy}
              onCommit={(v) => commit({ loopIntervalSec: v })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <ColorRow
              id="text-bg-color"
              label="Background color"
              value={params.bgColor}
              disabled={textConfigBusy}
              onChange={(v) => commit({ bgColor: v })}
            />
            <ColorRow
              id="text-color"
              label="Text color"
              value={params.textColor}
              disabled={textConfigBusy}
              onChange={(v) => commit({ textColor: v })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Live preview</CardTitle>
          <CardDescription>
            Subscribed to runtime preview frames while text mode is active ({state.targetFps} fps target on
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
              Preview stream starts when text mode is the active output mode.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
