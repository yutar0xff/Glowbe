import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import {
  brightnessToPercent,
  formatBrightnessPercent,
  percentToBrightness,
  validateBrightnessPercent,
  validateOutputFps,
} from './device-output-settings'
import { clampFrontYawDeg, FRONT_YAW_DEG_MAX, FRONT_YAW_DEG_MIN } from './device-draft'

function commitOnEnter(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === 'Enter') {
    e.preventDefault()
    e.currentTarget.blur()
  }
}

export function DeviceOutputSettingsRow({
  idPrefix,
  fps,
  brightness,
  frontYawDeg,
  disabled,
  onFpsCommit,
  onBrightnessCommit,
  onFrontYawCommit,
}: {
  idPrefix: string
  fps?: number
  brightness: number
  frontYawDeg?: number
  disabled?: boolean
  onFpsCommit?: (fps: number) => void
  onBrightnessCommit: (brightness: number) => void
  onFrontYawCommit?: (deg: number) => void
}) {
  const dragging = useRef(false)
  const brightnessRef = useRef(brightness)
  const yawDragging = useRef(false)
  const [fpsText, setFpsText] = useState(fps !== undefined ? String(fps) : '')
  const [brightnessText, setBrightnessText] = useState(formatBrightnessPercent(brightness))
  const [displayBrightnessPct, setDisplayBrightnessPct] = useState(brightnessToPercent(brightness))
  const [displayYaw, setDisplayYaw] = useState(frontYawDeg ?? 0)
  const [yawText, setYawText] = useState(String(Math.round(frontYawDeg ?? 0)))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    brightnessRef.current = brightness
    if (!dragging.current) {
      setDisplayBrightnessPct(brightnessToPercent(brightness))
      setBrightnessText(formatBrightnessPercent(brightness))
    }
  }, [brightness])

  useEffect(() => {
    if (frontYawDeg === undefined) return
    if (!yawDragging.current) {
      setDisplayYaw(frontYawDeg)
      setYawText(String(Math.round(frontYawDeg)))
    }
  }, [frontYawDeg])

  useEffect(() => {
    if (fps !== undefined) {
      setFpsText(String(fps))
    }
  }, [fps])

  const commitBrightness = (next: number) => {
    brightnessRef.current = next
    setDisplayBrightnessPct(brightnessToPercent(next))
    setBrightnessText(formatBrightnessPercent(next))
    onBrightnessCommit(next)
  }

  const commitFps = () => {
    if (fps === undefined || !onFpsCommit) return
    const result = validateOutputFps(fpsText)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    if (result.value !== fps) {
      onFpsCommit(result.value)
    }
  }

  const commitBrightnessText = () => {
    const result = validateBrightnessPercent(brightnessText)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    if (result.value !== brightnessRef.current) {
      commitBrightness(result.value)
    } else {
      setBrightnessText(formatBrightnessPercent(result.value))
    }
  }

  const commitSlider = () => {
    dragging.current = false
    commitBrightness(brightnessRef.current)
  }

  const commitYawText = () => {
    if (frontYawDeg === undefined || !onFrontYawCommit) return
    const parsed = Number.parseFloat(yawText)
    if (!Number.isFinite(parsed)) {
      setError(`Front orientation must be ${FRONT_YAW_DEG_MIN}–${FRONT_YAW_DEG_MAX}°`)
      return
    }
    setError(null)
    const deg = clampFrontYawDeg(Math.round(parsed))
    setDisplayYaw(deg)
    setYawText(String(deg))
    if (deg !== Math.round(frontYawDeg)) {
      onFrontYawCommit(deg)
    }
  }

  return (
    <div className="space-y-2">
      <div className={`grid grid-cols-1 gap-4 ${fps !== undefined ? 'sm:grid-cols-2' : 'sm:grid-cols-1'}`}>
        {fps !== undefined ? (
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-fps`} className="font-mono text-xs font-semibold">
              Output FPS
            </Label>
            <Input
              id={`${idPrefix}-fps`}
              type="number"
              min={1}
              className="font-mono text-xs tabular-nums"
              value={fpsText}
              disabled={disabled}
              onChange={(e) => {
                setFpsText(e.target.value)
                setError(null)
              }}
              onBlur={() => commitFps()}
              onKeyDown={commitOnEnter}
            />
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-brightness`} className="font-mono text-xs font-semibold">
            Brightness (%)
          </Label>
          <div className="relative">
            <Input
              id={`${idPrefix}-brightness-text`}
              inputMode="decimal"
              className="font-mono text-xs tabular-nums pr-7"
              value={brightnessText}
              disabled={disabled}
              onChange={(e) => {
                setBrightnessText(e.target.value)
                setError(null)
              }}
              onBlur={() => commitBrightnessText()}
              onKeyDown={commitOnEnter}
            />
            <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center font-mono text-xs text-muted-foreground">
              %
            </span>
          </div>
          <Slider
            id={`${idPrefix}-brightness`}
            disabled={disabled}
            min={0}
            max={100}
            step={1}
            value={[displayBrightnessPct]}
            onValueChange={(vals) => {
              dragging.current = true
              const pct = vals[0]!
              const next = percentToBrightness(pct)
              brightnessRef.current = next
              setDisplayBrightnessPct(pct)
              setBrightnessText(String(pct))
            }}
            onValueCommit={(vals) => {
              brightnessRef.current = percentToBrightness(vals[0]!)
              commitSlider()
            }}
          />
        </div>
      </div>
      {frontYawDeg !== undefined && onFrontYawCommit ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={`${idPrefix}-front-yaw`} className="font-mono text-xs font-semibold">
              Front orientation (°)
            </Label>
            <div className="relative w-20">
              <Input
                id={`${idPrefix}-front-yaw-text`}
                inputMode="numeric"
                className="h-7 pr-5 text-right font-mono text-xs tabular-nums"
                value={yawText}
                disabled={disabled}
                onChange={(e) => {
                  setYawText(e.target.value)
                  setError(null)
                }}
                onBlur={() => commitYawText()}
                onKeyDown={commitOnEnter}
              />
              <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center font-mono text-xs text-muted-foreground">
                °
              </span>
            </div>
          </div>
          <Slider
            id={`${idPrefix}-front-yaw`}
            disabled={disabled}
            min={FRONT_YAW_DEG_MIN}
            max={FRONT_YAW_DEG_MAX}
            step={1}
            value={[Math.round(clampFrontYawDeg(displayYaw))]}
            onValueChange={(vals) => {
              yawDragging.current = true
              setDisplayYaw(vals[0]!)
              setYawText(String(Math.round(vals[0]!)))
            }}
            onValueCommit={(vals) => {
              yawDragging.current = false
              const deg = clampFrontYawDeg(vals[0]!)
              setDisplayYaw(deg)
              setYawText(String(deg))
              onFrontYawCommit(deg)
            }}
          />
        </div>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}
