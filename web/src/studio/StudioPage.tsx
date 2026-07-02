import { useEffect, useState } from 'react'
import { Moon, MousePointer2, Repeat, Smile, Type } from 'lucide-react'
import type { OutputMode } from '@/types'
import { MATE_LAYOUT_ID } from '@/types'
import { useGlowbeRuntime } from '@/GlowbeRuntimeContext'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DeviceManagerSection } from './DeviceManagerSection'
import { InteractiveModePanel } from './InteractiveModePanel'
import { LoopModePanel } from './LoopModePanel'
import { MateModePanel } from './MateModePanel'
import { StatusSection } from './StatusSection'
import { TextModePanel } from './TextModePanel'

const ALL_MODES: OutputMode[] = ['idle', 'loop', 'interactive', 'mate', 'text']

const modeMeta: Record<
  OutputMode,
  { label: string; description: string; icon: typeof Repeat }
> = {
  loop: {
    label: 'Loop',
    description: 'Play a built-in demo, uploaded clip, or the test pattern.',
    icon: Repeat,
  },
  interactive: {
    label: 'Interactive',
    description: 'Dark base; tap the layout map to stack light pulses.',
    icon: MousePointer2,
  },
  mate: {
    label: 'Mate',
    description: 'Face expressions on the geodesic sphere with smooth morph transitions.',
    icon: Smile,
  },
  text: {
    label: 'Text',
    description: 'Flow a word or sentence around the sphere; it fades in and out behind the front.',
    icon: Type,
  },
  idle: {
    label: 'Idle',
    description: 'Lights off; loop selection is cleared.',
    icon: Moon,
  },
}

function panelMode(mode: string): OutputMode {
  if (mode === 'mate') return 'mate'
  if (mode === 'loop') return 'loop'
  if (mode === 'interactive') return 'interactive'
  if (mode === 'text') return 'text'
  return 'idle'
}

export function StudioPage() {
  const { load, modeBusy, layoutBusy, setMode } = useGlowbeRuntime()
  const [studioTab, setStudioTab] = useState<OutputMode | null>(null)

  const stateMode = load.kind === 'ready' ? load.state.mode : null
  const layoutId = load.kind === 'ready' ? load.state.layoutId : null

  useEffect(() => {
    setStudioTab(null)
  }, [stateMode, layoutId])

  if (load.kind !== 'ready') return null
  const { state, clips } = load

  const mateSupported = state.layoutId === MATE_LAYOUT_ID
  const serverModeKey = panelMode(state.mode)
  const modeKey = studioTab ?? serverModeKey

  const pickMode = (next: string) => {
    if (modeBusy !== null) return
    const nextMode = next as OutputMode
    if (nextMode === modeKey) return
    if (nextMode === 'mate' && !mateSupported) {
      setStudioTab('mate')
      return
    }
    setStudioTab(null)
    void setMode(nextMode)
  }

  return (
    <div className="flex flex-col gap-8 md:gap-10">
      <DeviceManagerSection />

      <Tabs value={modeKey} onValueChange={pickMode} className="flex flex-col gap-0">
        <div className="space-y-4">
          <span className="text-sm font-medium text-muted-foreground">Mode</span>
          <TabsList variant="segmented" className="max-w-full">
            {ALL_MODES.map((mode) => {
              const { label, icon: Icon } = modeMeta[mode]
              return (
                <TabsTrigger
                  key={mode}
                  value={mode}
                  disabled={modeBusy !== null || layoutBusy}
                  className="box-border flex h-full min-h-12 w-full min-w-0 items-center justify-center gap-2 rounded-md px-3 py-2.5 text-xs font-medium after:hidden sm:min-h-12 sm:py-2.5 sm:text-sm"
                  aria-label={label}
                >
                  <Icon className="size-4 shrink-0 opacity-80" aria-hidden />
                  <span className="truncate">{label}</span>
                </TabsTrigger>
              )
            })}
          </TabsList>
          <p className="relative z-10 mt-1 text-pretty border-t border-border/40 pt-3 text-sm leading-relaxed text-muted-foreground">
            {modeMeta[modeKey].description}
          </p>
          {modeBusy !== null ? (
            <p className="text-xs text-muted-foreground">
              Switching to {modeMeta[modeBusy as OutputMode]?.label ?? modeBusy}…
            </p>
          ) : null}
        </div>

        <TabsContent value="idle" className="mt-6 outline-none focus-visible:outline-none sm:mt-10" />
        <TabsContent value="loop" className="mt-6 space-y-6 outline-none focus-visible:outline-none sm:mt-10">
          <LoopModePanel state={state} clips={clips} />
        </TabsContent>
        <TabsContent value="interactive" className="mt-6 space-y-6 outline-none focus-visible:outline-none sm:mt-10">
          <InteractiveModePanel state={state} />
        </TabsContent>
        <TabsContent value="mate" className="mt-6 space-y-6 outline-none focus-visible:outline-none sm:mt-10">
          <MateModePanel state={state} />
        </TabsContent>
        <TabsContent value="text" className="mt-6 space-y-6 outline-none focus-visible:outline-none sm:mt-10">
          <TextModePanel state={state} />
        </TabsContent>
      </Tabs>

      <Separator />

      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Runtime status</h2>
        <StatusSection />
      </section>
    </div>
  )
}
