import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import {
  brightnessToPercent,
  formatBrightnessPercent,
  formatGamma,
  percentToBrightness,
  validateBrightnessPercent,
  validateGamma,
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
  gamma,
  frontYawDeg,
  disabled,
  onFpsCommit,
  onToneCommit,
  onFrontYawCommit,
}: {
  idPrefix: string
  fps?: number
  brightness: number
  gamma: number
  frontYawDeg?: number
  disabled?: boolean
  onFpsCommit?: (fps: number) => void
  onToneCommit: (brightness: number, gamma: number) => void
  onFrontYawCommit?: (deg: number) => void
}) {
  const dragging = useRef(false)
  const toneRef = useRef({ brightness, gamma })
  const yawDragging = useRef(false)
  const [fpsText, setFpsText] = useState(fps !== undefined ? String(fps) : '')
  const [brightnessText, setBrightnessText] = useState(formatBrightnessPercent(brightness))
  const [gammaText, setGammaText] = useState(formatGamma(gamma))
  const [displayBrightnessPct, setDisplayBrightnessPct] = useState(brightnessToPercent(brightness))
  const [displayGamma, setDisplayGamma] = useState(gamma)
  const [displayYaw, setDisplayYaw] = useState(frontYawDeg ?? 0)
  const [yawText, setYawText] = useState(String(Math.round(frontYawDeg ?? 0)))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    toneRef.current = { brightness, gamma }
    if (!dragging.current) {
      setDisplayBrightnessPct(brightnessToPercent(brightness))
      setDisplayGamma(gamma)
      setBrightnessText(formatBrightnessPercent(brightness))
      setGammaText(formatGamma(gamma))
    }
  }, [brightness, gamma])

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

  const commitTone = (nextBrightness: number, nextGamma: number) => {
    toneRef.current = { brightness: nextBrightness, gamma: nextGamma }
    setDisplayBrightnessPct(brightnessToPercent(nextBrightness))
    setDisplayGamma(nextGamma)
    setBrightnessText(formatBrightnessPercent(nextBrightness))
    setGammaText(formatGamma(nextGamma))
    onToneCommit(nextBrightness, nextGamma)
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
    if (result.value !== toneRef.current.brightness) {
      commitTone(result.value, toneRef.current.gamma)
    } else {
      setBrightnessText(formatBrightnessPercent(result.value))
    }
  }

  const commitGammaText = () => {
    const result = validateGamma(gammaText)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    if (result.value !== toneRef.current.gamma) {
      commitTone(toneRef.current.brightness, result.value)
    } else {
      setGammaText(formatGamma(result.value))
    }
  }

  const commitSlider = () => {
    dragging.current = false
    commitTone(toneRef.current.brightness, toneRef.current.gamma)
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
      <div className={`grid grid-cols-1 gap-4 ${fps !== undefined ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
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
              toneRef.current.brightness = next
              setDisplayBrightnessPct(pct)
              setBrightnessText(String(pct))
            }}
            onValueCommit={(vals) => {
              toneRef.current.brightness = percentToBrightness(vals[0]!)
              commitSlider()
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-gamma`} className="font-mono text-xs font-semibold">
            Gamma
          </Label>
          <Input
            id={`${idPrefix}-gamma-text`}
            inputMode="decimal"
            className="font-mono text-xs tabular-nums"
            value={gammaText}
            disabled={disabled}
            onChange={(e) => {
              setGammaText(e.target.value)
              setError(null)
            }}
            onBlur={() => commitGammaText()}
            onKeyDown={commitOnEnter}
          />
          <Slider
            id={`${idPrefix}-gamma`}
            disabled={disabled}
            min={45}
            max={350}
            step={1}
            value={[Math.round(displayGamma * 100)]}
            onValueChange={(vals) => {
              dragging.current = true
              const next = vals[0]! / 100
              toneRef.current.gamma = next
              setDisplayGamma(next)
              setGammaText(formatGamma(next))
            }}
            onValueCommit={(vals) => {
              toneRef.current.gamma = vals[0]! / 100
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
