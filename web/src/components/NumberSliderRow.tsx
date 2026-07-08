import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'

function commitOnEnter(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === 'Enter') {
    e.preventDefault()
    e.currentTarget.blur()
  }
}

export function NumberSliderRow({
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
  const decimals = step < 1 ? 2 : 0
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
