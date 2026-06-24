import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown, Loader2, Pencil, Plus, Radio, Trash2 } from 'lucide-react'
import type { CompiledLayoutSummary, DeviceCreateInput, DeviceRecord, DiscoveredEsp } from '@/types'
import { API_BASE, fetchDiscoveredEsps } from '@/api'
import { useGlowbeRuntime } from '@/GlowbeRuntimeContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

function deviceLabel(id: string, displayName: string) {
  const name = displayName.trim()
  const short = `${id.slice(0, 8)}…`
  if (!name || name === id) return short
  return `${name} (${short})`
}

type Draft = {
  displayName: string
  espIp: string
  mdnsHostname: string
  layoutId: string
}

type CreateDraft = Draft

function emptyCreateDraft(layoutId: string): CreateDraft {
  return {
    displayName: '',
    espIp: '',
    mdnsHostname: '',
    layoutId,
  }
}

function editDraftFromRecord(rec: DeviceRecord): Draft {
  return {
    displayName: rec.displayName ?? '',
    espIp: rec.espIp ?? '',
    mdnsHostname: rec.mdnsHostname ?? '',
    layoutId: rec.layoutId,
  }
}

function toRecord(id: string, draft: Draft): DeviceRecord {
  const slug = id.trim()
  return {
    id: slug,
    displayName: draft.displayName.trim() || slug,
    espIp: draft.espIp.trim() || null,
    mdnsHostname: draft.mdnsHostname.trim() || null,
    layoutId: draft.layoutId.trim(),
  }
}

function DeviceEditForm({
  deviceId,
  draft,
  catalog,
  layoutLabel,
  saveBusy,
  onChange,
  onSave,
  onCancel,
}: {
  deviceId: string
  draft: Draft
  catalog: CompiledLayoutSummary[] | null
  layoutLabel: (id: string) => string
  saveBusy: boolean
  onChange: (patch: Partial<Draft>) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="space-y-3 border-t border-border/60 bg-muted/10 px-3 py-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Device ID</Label>
          <p className="font-mono text-xs text-cyan-400">{deviceId}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${deviceId}-name`}>Display name</Label>
          <Input
            id={`${deviceId}-name`}
            value={draft.displayName}
            onChange={(e) => onChange({ displayName: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${deviceId}-ip`}>ESP IP</Label>
          <Input
            id={`${deviceId}-ip`}
            className="font-mono text-xs"
            value={draft.espIp}
            onChange={(e) => onChange({ espIp: e.target.value })}
            placeholder="192.168.0.58"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${deviceId}-mdns`}>mDNS hostname</Label>
          <Input
            id={`${deviceId}-mdns`}
            className="font-mono text-xs"
            value={draft.mdnsHostname}
            onChange={(e) => onChange({ mdnsHostname: e.target.value })}
            placeholder="glowbe-proto"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`${deviceId}-layout`}>Layout</Label>
          {catalog && catalog.length > 0 ? (
            <Select value={draft.layoutId} onValueChange={(value) => onChange({ layoutId: value })}>
              <SelectTrigger id={`${deviceId}-layout`} className="font-mono text-xs">
                <SelectValue placeholder="Select layout" />
              </SelectTrigger>
              <SelectContent>
                {catalog.map((row) => (
                  <SelectItem key={row.layoutId} value={row.layoutId} className="font-mono text-xs">
                    {layoutLabel(row.layoutId)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id={`${deviceId}-layout`}
              className="font-mono text-xs"
              value={draft.layoutId}
              onChange={(e) => onChange({ layoutId: e.target.value })}
            />
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={onSave} disabled={saveBusy}>
          {saveBusy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
          Save
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={saveBusy}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

export function DeviceManagerSection() {
  const {
    load,
    activeDeviceId,
    devices,
    refreshDevices,
    upsertDevice,
    updateDevice,
    deleteDevice,
    setActiveDevice,
  } = useGlowbeRuntime()
  const layoutId = load.kind === 'ready' ? load.state.layoutId : 'prototype-icosahedron-15'
  const [expandedEditId, setExpandedEditId] = useState<string | null>(null)
  const [editDrafts, setEditDrafts] = useState<Record<string, Draft>>({})
  const [createOpen, setCreateOpen] = useState(false)
  const [createDraft, setCreateDraft] = useState<CreateDraft>(() => emptyCreateDraft(layoutId))
  const [catalog, setCatalog] = useState<CompiledLayoutSummary[] | null>(null)
  const [discovered, setDiscovered] = useState<DiscoveredEsp[]>([])
  const [scanBusy, setScanBusy] = useState(false)
  const [saveBusyId, setSaveBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/layouts`, { signal: ac.signal })
        if (!res.ok) return
        const rows = (await res.json()) as CompiledLayoutSummary[]
        setCatalog(rows)
      } catch {
        /* optional */
      }
    })()
    return () => ac.abort()
  }, [])

  useEffect(() => {
    setCreateDraft((d) => ({ ...d, layoutId: layoutId || d.layoutId }))
  }, [layoutId])

  const layoutLabel = (id: string) => {
    const row = catalog?.find((r) => r.layoutId === id)
    if (row?.displayName?.trim()) return `${row.displayName.trim()} (${id})`
    return id
  }

  const scanLan = useCallback(async () => {
    setScanBusy(true)
    setError(null)
    const controller = new AbortController()
    try {
      const list = await fetchDiscoveredEsps(controller.signal)
      setDiscovered(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setScanBusy(false)
    }
  }, [])

  const toggleEdit = (rec: DeviceRecord) => {
    if (expandedEditId === rec.id) {
      setExpandedEditId(null)
      return
    }
    setExpandedEditId(rec.id)
    setEditDrafts((prev) => ({
      ...prev,
      [rec.id]: prev[rec.id] ?? editDraftFromRecord(rec),
    }))
    setError(null)
  }

  const selectDevice = (id: string) => {
    if (id !== activeDeviceId) setActiveDevice(id)
  }

  const patchEditDraft = (id: string, patch: Partial<Draft>) => {
    setEditDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? editDraftFromRecord(devices.find((d) => d.id === id)!)), ...patch },
    }))
  }

  const saveEdit = async (id: string) => {
    const draft = editDrafts[id]
    if (!draft) return
    setSaveBusyId(id)
    setError(null)
    try {
      const rec = toRecord(id, draft)
      if (!rec.layoutId) {
        setError('Layout ID is required.')
        return
      }
      await updateDevice(rec)
      setExpandedEditId(null)
      setEditDrafts((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      await refreshDevices()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaveBusyId(null)
    }
  }

  const applyDiscoveredTo = (targetId: string | 'create', esp: DiscoveredEsp) => {
    const patch = { espIp: esp.ipv4, mdnsHostname: esp.hostname }
    if (targetId === 'create') {
      setCreateDraft((d) => ({
        ...d,
        ...patch,
        displayName: d.displayName || esp.hostname,
      }))
      setCreateOpen(true)
    } else {
      patchEditDraft(targetId, patch)
      setExpandedEditId(targetId)
    }
  }

  const saveCreate = async () => {
    setSaveBusyId('__create__')
    setError(null)
    try {
      const input: DeviceCreateInput = {
        displayName: createDraft.displayName.trim() || 'Device',
        espIp: createDraft.espIp.trim() || null,
        mdnsHostname: createDraft.mdnsHostname.trim() || null,
        layoutId: createDraft.layoutId.trim(),
      }
      if (!input.layoutId) {
        setError('Layout ID is required.')
        return
      }
      const createdId = await upsertDevice(input)
      setCreateDraft(emptyCreateDraft(layoutId))
      setCreateOpen(false)
      if (createdId) setActiveDevice(createdId)
      await refreshDevices()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaveBusyId(null)
    }
  }

  const removeDevice = async (id: string) => {
    setError(null)
    try {
      await deleteDevice(id)
      if (expandedEditId === id) setExpandedEditId(null)
      setEditDrafts((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      await refreshDevices()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Device</CardTitle>
        <CardDescription>
          Select the device to control in the tabs below. Open a row to edit IP, layout, and other settings per device.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {devices.length > 1 ? (
          <div className="space-y-1.5">
            <Label htmlFor="active-device">Active device</Label>
            <Select value={activeDeviceId ?? undefined} onValueChange={selectDevice}>
              <SelectTrigger id="active-device" className="w-full max-w-md font-mono text-xs">
                <SelectValue placeholder="Select device" />
              </SelectTrigger>
              <SelectContent>
                {devices.map((d) => (
                  <SelectItem key={d.id} value={d.id} className="font-mono text-xs">
                    {deviceLabel(d.id, d.displayName)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void scanLan()} disabled={scanBusy}>
              {scanBusy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Radio className="size-4" aria-hidden />}
              Scan LAN
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void refreshDevices()}>
              Refresh list
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setCreateOpen((o) => !o)
                setError(null)
              }}
            >
              <Plus className="size-4" aria-hidden />
              Add device
            </Button>
          </div>
          {discovered.length > 0 ? (
            <ul className="space-y-1 rounded-md border p-2 text-sm">
              {discovered.map((esp) => (
                <li key={`${esp.hostname}:${esp.ipv4}`} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs">
                    {esp.hostname} · {esp.ipv4}:{esp.port}
                    {esp.registeredDeviceId ? ` · ${esp.registeredDeviceId}` : ''}
                  </span>
                  <div className="flex gap-1">
                    {esp.registeredDeviceId ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => applyDiscoveredTo(esp.registeredDeviceId!, esp)}
                      >
                        Edit {esp.registeredDeviceId}
                      </Button>
                    ) : null}
                    <Button type="button" size="sm" variant="ghost" onClick={() => applyDiscoveredTo('create', esp)}>
                      New
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {createOpen ? (
          <div className="space-y-3 rounded-lg border border-dashed border-border/80 bg-muted/15 p-4">
            <p className="text-sm font-medium">New device</p>
            <p className="text-xs text-muted-foreground">
              A UUID v7 device ID is assigned automatically when you add.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="create-name">Display name</Label>
                <Input
                  id="create-name"
                  value={createDraft.displayName}
                  onChange={(e) => setCreateDraft((d) => ({ ...d, displayName: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-ip">ESP IP</Label>
                <Input
                  id="create-ip"
                  className="font-mono text-xs"
                  value={createDraft.espIp}
                  onChange={(e) => setCreateDraft((d) => ({ ...d, espIp: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-mdns">mDNS hostname</Label>
                <Input
                  id="create-mdns"
                  className="font-mono text-xs"
                  value={createDraft.mdnsHostname}
                  onChange={(e) => setCreateDraft((d) => ({ ...d, mdnsHostname: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="create-layout">Layout</Label>
                {catalog && catalog.length > 0 ? (
                  <Select
                    value={createDraft.layoutId}
                    onValueChange={(value) => setCreateDraft((d) => ({ ...d, layoutId: value }))}
                  >
                    <SelectTrigger id="create-layout" className="font-mono text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {catalog.map((row) => (
                        <SelectItem key={row.layoutId} value={row.layoutId} className="font-mono text-xs">
                          {layoutLabel(row.layoutId)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id="create-layout"
                    className="font-mono text-xs"
                    value={createDraft.layoutId}
                    onChange={(e) => setCreateDraft((d) => ({ ...d, layoutId: e.target.value }))}
                  />
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => void saveCreate()}
                disabled={saveBusyId === '__create__'}
              >
                {saveBusyId === '__create__' ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Plus className="size-4" aria-hidden />
                )}
                Add
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <ul className="divide-y rounded-md border">
          {devices.map((d) => {
            const expanded = expandedEditId === d.id
            const draft = editDrafts[d.id] ?? editDraftFromRecord(d)
            const active = d.id === activeDeviceId
            return (
              <li key={d.id}>
                <div
                  className={cn(
                    'flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm',
                    active && 'bg-cyan-500/5',
                  )}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-start gap-2 text-left"
                    onClick={() => selectDevice(d.id)}
                  >
                    <span
                      className={cn(
                        'mt-1 size-2 shrink-0 rounded-full',
                        active ? 'bg-cyan-400' : 'bg-muted-foreground/30',
                      )}
                      aria-hidden
                    />
                    <div className="min-w-0 font-mono text-xs">
                      <span className={active ? 'text-cyan-400' : ''} title={d.id}>
                        {d.displayName && d.displayName !== d.id ? d.displayName : d.id.slice(0, 8)}
                      </span>
                      {d.displayName && d.displayName !== d.id ? (
                        <span className="ml-2 text-muted-foreground">{d.id.slice(0, 13)}…</span>
                      ) : null}
                      <div className="text-muted-foreground">
                        {d.espIp ?? (d.mdnsHostname ? `mDNS:${d.mdnsHostname}` : 'mDNS auto')} · {layoutLabel(d.layoutId)}
                      </div>
                    </div>
                  </button>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant={expanded ? 'secondary' : 'ghost'}
                      aria-label={`Edit ${d.displayName || d.id}`}
                      onClick={() => toggleEdit(d)}
                    >
                      {expanded ? (
                        <ChevronDown className="size-4" aria-hidden />
                      ) : (
                        <Pencil className="size-4" aria-hidden />
                      )}
                      Edit
                    </Button>
                    {devices.length > 1 ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        aria-label={`Delete ${d.id}`}
                        onClick={() => void removeDevice(d.id)}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                </div>
                {expanded ? (
                  <DeviceEditForm
                    deviceId={d.id}
                    draft={draft}
                    catalog={catalog}
                    layoutLabel={layoutLabel}
                    saveBusy={saveBusyId === d.id}
                    onChange={(patch) => patchEditDraft(d.id, patch)}
                    onSave={() => void saveEdit(d.id)}
                    onCancel={() => {
                      setExpandedEditId(null)
                      setEditDrafts((prev) => {
                        const next = { ...prev }
                        delete next[d.id]
                        return next
                      })
                    }}
                  />
                ) : null}
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
