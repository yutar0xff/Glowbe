import { Moon, MousePointer2, Repeat, Sparkles } from 'lucide-react'
import type { OutputMode } from '@/types'
import { useGlowbeRuntime } from '@/GlowbeRuntimeContext'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { IdleModePanel } from './IdleModePanel'
import { InteractiveModePanel } from './InteractiveModePanel'
import { LoopModePanel } from './LoopModePanel'
import { MateModePanel } from './MateModePanel'
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
  if (mode === 'interactive' || mode === 'ripple') return 'interactive'
  if (mode === 'mate') return 'mate'
  return 'idle'
}

export function StudioPage() {
  const { load, modeBusy, setMode } = useGlowbeRuntime()
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
      <Tabs value={modeKey} onValueChange={pickMode} className="flex flex-col gap-0">
        <div className="space-y-3">
          <TabsList className="grid h-11 w-full max-w-full grid-cols-2 gap-0.5 p-1 sm:grid-cols-4 sm:h-12">
            {MODES.map((mode) => {
              const { label, icon: Icon } = modeMeta[mode]
              return (
                <TabsTrigger
                  key={mode}
                  value={mode}
                  disabled={modeBusy !== null}
                  className="flex items-center justify-center gap-2 rounded-md px-2 text-xs font-medium sm:text-sm"
                  aria-label={label}
                >
                  <Icon className="size-4 shrink-0 opacity-80" aria-hidden />
                  <span className="truncate">{label}</span>
                </TabsTrigger>
              )
            })}
          </TabsList>
          <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
            {modeMeta[modeKey].description}
          </p>
          {modeBusy !== null ? (
            <p className="text-xs text-muted-foreground">
              Switching to {modeMeta[modeBusy as OutputMode]?.label ?? modeBusy}…
            </p>
          ) : null}
        </div>

        <TabsContent value="idle" className="mt-8 space-y-6 outline-none focus-visible:outline-none">
          <IdleModePanel state={state} />
        </TabsContent>
        <TabsContent value="loop" className="mt-8 space-y-6 outline-none focus-visible:outline-none">
          <LoopModePanel state={state} sequences={sequences} />
        </TabsContent>
        <TabsContent value="interactive" className="mt-8 space-y-6 outline-none focus-visible:outline-none">
          <InteractiveModePanel state={state} />
        </TabsContent>
        <TabsContent value="mate" className="mt-8 space-y-6 outline-none focus-visible:outline-none">
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
