import { useCallback, useEffect, useRef, useState } from 'react'
import { Settings2 } from 'lucide-react'
import { useGlowbeRuntime } from '@/GlowbeRuntimeContext'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Slider } from '@/components/ui/slider'

const DEBOUNCE_MS = 200

export function MasterToneDrawer() {
  const { load, setMasterTone, masterToneBusy } = useGlowbeRuntime()
  const [open, setOpen] = useState(false)
  const [brightness, setBrightness] = useState(1)
  const [gamma, setGamma] = useState(1)
  const debounceRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    return () => {
      if (debounceRef.current !== undefined) window.clearTimeout(debounceRef.current)
    }
  }, [])

  const schedulePush = useCallback(
    (b: number, g: number) => {
      if (debounceRef.current !== undefined) window.clearTimeout(debounceRef.current)
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = undefined
        void setMasterTone(b, g)
      }, DEBOUNCE_MS)
    },
    [setMasterTone],
  )

  const onBrightness = (vals: number[]) => {
    const b = vals[0]! / 100
    setBrightness(b)
    schedulePush(b, gamma)
  }

  const onGamma = (vals: number[]) => {
    const g = vals[0]! / 100
    setGamma(g)
    schedulePush(brightness, g)
  }

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (next && load.kind === 'ready') {
      setBrightness(load.state.masterBrightness)
      setGamma(load.state.masterGamma)
    }
  }

  if (load.kind !== 'ready') return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={masterToneBusy}
          aria-label="Master output settings"
          title="Master brightness & gamma (all modes)"
        >
          <Settings2 className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Master output</SheetTitle>
          <SheetDescription>
            Applied to the final color for every output mode (loop, interactive, idle).
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-6 px-4 pb-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="master-brightness" className="font-mono text-xs font-semibold">
                Brightness
              </Label>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {(brightness * 100).toFixed(0)}%
              </span>
            </div>
            <Slider
              id="master-brightness"
              disabled={masterToneBusy}
              min={0}
              max={200}
              step={1}
              value={[Math.round(brightness * 100)]}
              onValueChange={onBrightness}
            />
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="master-gamma" className="font-mono text-xs font-semibold">
                Gamma
              </Label>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">{gamma.toFixed(2)}</span>
            </div>
            <Slider
              id="master-gamma"
              disabled={masterToneBusy}
              min={45}
              max={350}
              step={1}
              value={[Math.round(gamma * 100)]}
              onValueChange={onGamma}
            />
          </div>
          {masterToneBusy ? <p className="text-sm text-muted-foreground">Saving…</p> : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}
