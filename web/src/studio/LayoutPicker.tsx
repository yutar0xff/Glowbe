import { useEffect, useState } from 'react'
import type { CompiledLayoutSummary } from '@/types'
import { API_BASE } from '@/api'
import { useGlowbeRuntime } from '@/GlowbeRuntimeContext'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export function LayoutPicker() {
  const { load, layoutBusy, setDeviceLayout } = useGlowbeRuntime()
  const [catalog, setCatalog] = useState<CompiledLayoutSummary[] | null>(null)
  const [catalogErr, setCatalogErr] = useState<string | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/layouts`, { signal: ac.signal })
        if (!res.ok) {
          setCatalogErr(`Could not list layouts (${res.status}).`)
          return
        }
        const rows = (await res.json()) as CompiledLayoutSummary[]
        setCatalog(rows)
        setCatalogErr(null)
      } catch (e) {
        if (ac.signal.aborted) return
        setCatalogErr(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => ac.abort()
  }, [])

  if (load.kind !== 'ready') return null
  const { state } = load

  const labelFor = (id: string) => {
    const row = catalog?.find((r) => r.layoutId === id)
    if (row?.displayName?.trim()) return `${row.displayName.trim()} (${id})`
    return id
  }

  return (
    <div className="space-y-2 rounded-lg border border-border/80 bg-muted/20 p-4">
      <Label className="text-xs font-semibold">LED layout</Label>
      <p className="text-pretty text-xs leading-relaxed text-muted-foreground">
        Runtime UV and frame size follow this selection. The ESP must be flashed with the matching generated header
        (see firmware README). Switching clears loop playback if the current sequence targets another layout.
      </p>
      {catalogErr ? (
        <p className="text-xs text-destructive" role="alert">
          {catalogErr}
        </p>
      ) : null}
      <Select
        value={state.layoutId}
        disabled={layoutBusy || catalog === null || catalog.length === 0}
        onValueChange={(id) => void setDeviceLayout(id)}
      >
        <SelectTrigger className="w-full max-w-md text-xs" aria-label="LED layout">
          <SelectValue placeholder={catalog === null ? 'Loading layouts…' : state.layoutId} />
        </SelectTrigger>
        <SelectContent>
          {(catalog ?? []).map((row) => (
            <SelectItem key={row.layoutId} value={row.layoutId} className="text-xs">
              {row.displayName?.trim() ? `${row.displayName.trim()} · ` : ''}
              {row.layoutId} ({row.ledCount} LEDs)
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {layoutBusy ? <p className="text-xs text-muted-foreground">Applying layout…</p> : null}
      {!layoutBusy ? (
        <p className="font-mono text-[10px] text-muted-foreground">Active: {labelFor(state.layoutId)}</p>
      ) : null}
    </div>
  )
}
