import { Moon, MousePointer2, Repeat, Sparkles } from 'lucide-react'
import type { OutputMode } from '@/types'
import { useGlowbeRuntime } from '@/GlowbeRuntimeContext'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { IdleModePanel } from './IdleModePanel'
import { InteractiveModePanel } from './InteractiveModePanel'
import { LoopModePanel } from './LoopModePanel'
import { MateModePanel } from './MateModePanel'
import { LayoutPicker } from './LayoutPicker'
import { StatusSection } from './StatusSection'

const MODES: OutputMode[] = ['idle', 'loop', 'interactive', 'mate']

const modeMeta: Record<
  OutputMode,
  { label: string; description: string; icon: typeof Repeat }
> = {
  loop: {
    label: 'Loop',
    description: 'Play a saved sequence or the built-in test pattern.',
    icon: Repeat,
  },
  interactive: {
    label: 'Interactive',
    description: 'Dark base; tap the layout map to stack light pulses.',
    icon: MousePointer2,
  },
  idle: {
    label: 'Idle',
    description: 'Lights off; loop selection is cleared.',
    icon: Moon,
  },
  mate: {
    label: 'Mate',
    description: 'Sphere-native face: gaze, idle choreography, and liquid motion on device LEDs.',
    icon: Sparkles,
  },
}

function panelMode(mode: string): OutputMode {
  if (mode === 'loop') return 'loop'
  if (mode === 'interactive') return 'interactive'
  if (mode === 'mate') return 'mate'
  return 'idle'
}

export function StudioPage() {
  const { load, modeBusy, layoutBusy, setMode } = useGlowbeRuntime()
  if (load.kind !== 'ready') return null
  const { state, sequences } = load

  const modeKey = panelMode(state.mode)

  const pickMode = (next: string) => {
    if (modeBusy !== null) return
    if (next === modeKey) return
    void setMode(next as OutputMode)
  }

  return (
    <div className="flex flex-col gap-8 md:gap-10">
      <LayoutPicker />

      <Tabs value={modeKey} onValueChange={pickMode} className="flex flex-col gap-0">
        <div className="space-y-4">
          <TabsList variant="segmented" className="max-w-full">
            {MODES.map((mode) => {
              const { label, icon: Icon } = modeMeta[mode]
              return (
                <TabsTrigger
                  key={mode}
                  value={mode}
                  disabled={modeBusy !== null || layoutBusy}
                  className="box-border flex h-full min-h-11 w-full min-w-0 items-center justify-center gap-2 rounded-md px-2 py-2 text-xs font-medium after:hidden sm:min-h-0 sm:py-0.5 sm:text-sm"
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

        <TabsContent value="idle" className="mt-6 space-y-6 outline-none focus-visible:outline-none sm:mt-10">
          <IdleModePanel state={state} />
        </TabsContent>
        <TabsContent value="loop" className="mt-6 space-y-6 outline-none focus-visible:outline-none sm:mt-10">
          <LoopModePanel state={state} sequences={sequences} />
        </TabsContent>
        <TabsContent value="interactive" className="mt-6 space-y-6 outline-none focus-visible:outline-none sm:mt-10">
          <InteractiveModePanel state={state} />
        </TabsContent>
        <TabsContent value="mate" className="mt-6 space-y-6 outline-none focus-visible:outline-none sm:mt-10">
          <MateModePanel state={state} />
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
