import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2, Pencil, Plus, Radio, RefreshCw, Trash2 } from 'lucide-react'
import type { CompiledLayoutSummary, DeviceCreateInput, DeviceRecord, DiscoveredEsp } from '@/types'
import { API_BASE, fetchDiscoveredEsps } from '@/api'
import { useGlowbeRuntime } from '@/GlowbeRuntimeContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DeviceQuickSettings } from './DeviceQuickSettings'
import { DeviceOutputSettingsRow } from './DeviceOutputSettingsRow'
import { validateOutputFps } from './device-output-settings'

const DEFAULT_OUTPUT_FPS = 120
const DEFAULT_MASTER_BRIGHTNESS = 1
const DEFAULT_MASTER_GAMMA = 1

type Draft = {
  displayName: string
  espIp: string
  mdnsHostname: string
  layoutId: string
  outputFps: string
  masterBrightness: number
  masterGamma: number
}
function normalizeMdnsHostname(raw: string): string {
  let s = raw.trim().replace(/\.+$/, '')
  if (s.endsWith('.local')) s = s.slice(0, -'.local'.length).replace(/\.+$/, '')
  return s
}

function formatMdnsHostnameForInput(host: string | null | undefined): string {
  const normalized = normalizeMdnsHostname(host ?? '')
  if (!normalized) return ''
  return `${normalized}.local`
}

function listDisplayName(rec: DeviceRecord): string {
  const name = rec.displayName?.trim()
  if (name) return name
  return 'Unnamed device'
}

function emptyCreateDraft(layoutId: string, outputFps: number): Draft {
  return {
    displayName: '',
    espIp: '',
    mdnsHostname: '',
    layoutId,
    outputFps: String(outputFps),
    masterBrightness: DEFAULT_MASTER_BRIGHTNESS,
    masterGamma: DEFAULT_MASTER_GAMMA,
  }
}

function editDraftFromRecord(rec: DeviceRecord, tone?: { brightness: number; gamma: number }): Draft {
  return {
    displayName: rec.displayName ?? '',
    espIp: rec.espIp ?? '',
    mdnsHostname: formatMdnsHostnameForInput(rec.mdnsHostname),
    layoutId: rec.layoutId,
    outputFps: String(rec.outputFps),
    masterBrightness: rec.masterBrightness ?? tone?.brightness ?? DEFAULT_MASTER_BRIGHTNESS,
    masterGamma: rec.masterGamma ?? tone?.gamma ?? DEFAULT_MASTER_GAMMA,
  }
}

function validateOutputFpsForDraft(raw: string): { ok: true; value: number } | { ok: false; error: string } {
  return validateOutputFps(raw)
}

function parseDraftFps(raw: string): number {
  const result = validateOutputFps(raw)
  return result.ok ? result.value : DEFAULT_OUTPUT_FPS
}

function toRecord(id: string, draft: Draft): DeviceRecord | { error: string } {
  const fps = validateOutputFpsForDraft(draft.outputFps)
  if (!fps.ok) return { error: fps.error }

  return {
    id,
    displayName:
      draft.displayName.trim() ||
      listDisplayName({
        id,
        displayName: '',
        layoutId: draft.layoutId,
        outputFps: fps.value,
        espIp: null,
        mdnsHostname: null,
      }),
    espIp: draft.espIp.trim() || null,
    mdnsHostname: draft.mdnsHostname.trim() ? normalizeMdnsHostname(draft.mdnsHostname) : null,
    layoutId: draft.layoutId.trim(),
    outputFps: fps.value,
    masterBrightness: draft.masterBrightness,
    masterGamma: draft.masterGamma,
  }
}

function DeviceEditForm({
  formKey,
  draft,
  catalog,
  layoutLabel,
  saveBusy,
  canDelete,
  showScan,
  scanBusy,
  discovered,
  onScanLan,
  onPickDiscovered,
  onChange,
  onSave,
  onCancel,
  onDelete,
  toneDisabled,
  onToneCommit,
}: {
  formKey: string
  draft: Draft
  catalog: CompiledLayoutSummary[] | null
  layoutLabel: (id: string) => string
  saveBusy: boolean
  canDelete: boolean
  showScan: boolean
  scanBusy: boolean
  discovered: DiscoveredEsp[]
  onScanLan: () => void
  onPickDiscovered: (esp: DiscoveredEsp) => void
  onChange: (patch: Partial<Draft>) => void
  onSave: () => void
  onCancel: () => void
  onDelete: () => void
  toneDisabled?: boolean
  onToneCommit: (brightness: number, gamma: number) => void
}) {
  return (
    <div className="space-y-3 px-0 py-0">
      {showScan ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onScanLan} disabled={scanBusy}>
              {scanBusy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Radio className="size-4" aria-hidden />}
              Scan LAN
            </Button>
          </div>
          {discovered.length > 0 ? (
            <ul className="space-y-1 rounded-md border border-dashed p-2">
              {discovered.map((esp) => (
                <li key={`${esp.hostname}:${esp.ipv4}`}>
                  <button
                    type="button"
                    className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted/60"
                    onClick={() => onPickDiscovered(esp)}
                  >
                    <span className="font-medium">{esp.hostname}</span>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{esp.ipv4}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`${formKey}-name`}>Display name</Label>
          <Input
            id={`${formKey}-name`}
            value={draft.displayName}
            onChange={(e) => onChange({ displayName: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${formKey}-ip`}>ESP IP</Label>
          <Input
            id={`${formKey}-ip`}
            className="font-mono text-xs"
            value={draft.espIp}
            onChange={(e) => onChange({ espIp: e.target.value })}
            placeholder="192.168.0.xx"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${formKey}-mdns`}>mDNS hostname</Label>
          <Input
            id={`${formKey}-mdns`}
            className="font-mono text-xs"
            value={draft.mdnsHostname}
            onChange={(e) => onChange({ mdnsHostname: e.target.value })}
            placeholder="glowbe.local"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`${formKey}-layout`}>Layout</Label>
          {catalog && catalog.length > 0 ? (
            <Select value={draft.layoutId} onValueChange={(value) => onChange({ layoutId: value })}>
              <SelectTrigger id={`${formKey}-layout`} className="font-mono text-xs">
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
              id={`${formKey}-layout`}
              className="font-mono text-xs"
              value={draft.layoutId}
              onChange={(e) => onChange({ layoutId: e.target.value })}
            />
          )}
        </div>
      </div>
      <DeviceOutputSettingsRow
        idPrefix={formKey}
        fps={parseDraftFps(draft.outputFps)}
        brightness={draft.masterBrightness}
        gamma={draft.masterGamma}
        disabled={toneDisabled}
        onFpsCommit={(value) => onChange({ outputFps: String(value) })}
        onToneCommit={onToneCommit}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={onSave} disabled={saveBusy}>
          {saveBusy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
          Save
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={saveBusy}>
          Cancel
        </Button>
        {canDelete ? (
          <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={onDelete} disabled={saveBusy}>
            <Trash2 className="size-4" aria-hidden />
            Delete
          </Button>
        ) : null}
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
    setMasterTone,
    masterToneBusy,
  } = useGlowbeRuntime()
  const layoutId = load.kind === 'ready' ? load.state.layoutId : 'prototype-icosahedron-15'
  const defaultFps = load.kind === 'ready' ? load.state.targetFps : DEFAULT_OUTPUT_FPS
  const liveTone = load.kind === 'ready'
    ? { brightness: load.state.masterBrightness, gamma: load.state.masterGamma }
    : null
  const [editMode, setEditMode] = useState(false)
  const [addingDevice, setAddingDevice] = useState(false)
  const [editDraft, setEditDraft] = useState<Draft | null>(null)
  const [createDraft, setCreateDraft] = useState<Draft>(() => emptyCreateDraft(layoutId, defaultFps))
  const [catalog, setCatalog] = useState<CompiledLayoutSummary[] | null>(null)
  const [discovered, setDiscovered] = useState<DiscoveredEsp[]>([])
  const [scanBusy, setScanBusy] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)
  const [quickSettingsBusy, setQuickSettingsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editCardRef = useRef<HTMLDivElement>(null)

  const selectedDevice = activeDeviceId ? devices.find((d) => d.id === activeDeviceId) : undefined
  const quickSettingsBusyOrTone = quickSettingsBusy || masterToneBusy

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
    setCreateDraft((d) => ({
      ...d,
      layoutId: layoutId || d.layoutId,
      outputFps: String(defaultFps || Number.parseInt(d.outputFps, 10) || DEFAULT_OUTPUT_FPS),
    }))
  }, [layoutId, defaultFps])

  useEffect(() => {
    if (!editMode || !selectedDevice) {
      setEditDraft(null)
      return
    }
    setEditDraft((prev) => {
      if (prev) return prev
      const tone =
        load.kind === 'ready'
          ? { brightness: load.state.masterBrightness, gamma: load.state.masterGamma }
          : undefined
      return editDraftFromRecord(selectedDevice, tone)
    })
  }, [editMode, selectedDevice, load])

  const exitEditMode = useCallback(() => {
    setEditMode(false)
    setAddingDevice(false)
    setEditDraft(null)
    setDiscovered([])
    setCreateDraft(emptyCreateDraft(layoutId, defaultFps))
    setError(null)
  }, [layoutId, defaultFps])

  useEffect(() => {
    if (!editMode) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (editCardRef.current?.contains(target)) return
      if ((target as Element).closest?.('[data-device-toolbar]')) return
      exitEditMode()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [editMode, exitEditMode])

  const layoutLabel = (id: string) => {
    const row = catalog?.find((r) => r.layoutId === id)
    if (row?.displayName?.trim()) return row.displayName.trim()
    return id
  }

  const applyDiscovered = (draft: Draft, esp: DiscoveredEsp): Draft => ({
    ...draft,
    espIp: esp.ipv4,
    mdnsHostname: formatMdnsHostnameForInput(esp.hostname),
    displayName: draft.displayName.trim() || normalizeMdnsHostname(esp.hostname),
  })

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

  const toggleEditMode = () => {
    if (editMode) {
      exitEditMode()
      return
    }
    setEditMode(true)
    setAddingDevice(false)
    setDiscovered([])
    setError(null)
    if (selectedDevice) {
      const tone =
        load.kind === 'ready'
          ? { brightness: load.state.masterBrightness, gamma: load.state.masterGamma }
          : undefined
      setEditDraft(editDraftFromRecord(selectedDevice, tone))
    }
  }

  const selectDevice = (id: string) => {
    if (id === activeDeviceId) return
    setActiveDevice(id)
    setAddingDevice(false)
    if (editMode) {
      const rec = devices.find((d) => d.id === id)
      if (rec) {
        const tone =
          load.kind === 'ready'
            ? { brightness: load.state.masterBrightness, gamma: load.state.masterGamma }
            : undefined
        setEditDraft(editDraftFromRecord(rec, tone))
      }
    }
  }

  const startAddDevice = () => {
    setEditMode(true)
    setAddingDevice(true)
    setDiscovered([])
    setError(null)
    setCreateDraft(emptyCreateDraft(layoutId, defaultFps))
  }

  const saveEdit = async () => {
    if (!selectedDevice || !editDraft) return
    setSaveBusy(true)
    setError(null)
    try {
      const rec = toRecord(selectedDevice.id, editDraft)
      if ('error' in rec) {
        setError(rec.error)
        return
      }
      if (!rec.layoutId) {
        setError('Layout is required.')
        return
      }
      await updateDevice(rec)
      exitEditMode()
      await refreshDevices()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaveBusy(false)
    }
  }

  const saveCreate = async () => {
    setSaveBusy(true)
    setError(null)
    try {
      const fps = validateOutputFpsForDraft(createDraft.outputFps)
      if (!fps.ok) {
        setError(fps.error)
        return
      }
      const input: DeviceCreateInput = {
        displayName: createDraft.displayName.trim() || 'Device',
        espIp: createDraft.espIp.trim() || null,
        mdnsHostname: createDraft.mdnsHostname.trim()
          ? normalizeMdnsHostname(createDraft.mdnsHostname)
          : null,
        layoutId: createDraft.layoutId.trim(),
        outputFps: fps.value,
        masterBrightness: createDraft.masterBrightness,
        masterGamma: createDraft.masterGamma,
      }
      if (!input.layoutId) {
        setError('Layout is required.')
        return
      }
      const createdId = await upsertDevice(input)
      exitEditMode()
      if (createdId) setActiveDevice(createdId)
      await refreshDevices()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaveBusy(false)
    }
  }

  const removeDevice = async () => {
    if (!selectedDevice) return
    setError(null)
    try {
      await deleteDevice(selectedDevice.id)
      exitEditMode()
      await refreshDevices()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const commitQuickFps = async (fps: number) => {
    if (!selectedDevice || fps === selectedDevice.outputFps) return
    setQuickSettingsBusy(true)
    setError(null)
    try {
      await updateDevice({
        ...selectedDevice,
        outputFps: fps,
        masterBrightness: selectedDevice.masterBrightness ?? liveTone?.brightness ?? DEFAULT_MASTER_BRIGHTNESS,
        masterGamma: selectedDevice.masterGamma ?? liveTone?.gamma ?? DEFAULT_MASTER_GAMMA,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setQuickSettingsBusy(false)
    }
  }

  const tabsValue = activeDeviceId ?? devices[0]?.id ?? ''

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-muted-foreground">Device</span>
        <div className="flex shrink-0 items-center gap-1" data-device-toolbar>
          <Button
            type="button"
            size="icon"
            variant={addingDevice ? 'secondary' : 'ghost'}
            className="size-8"
            aria-label="Add device"
            aria-pressed={addingDevice}
            onClick={startAddDevice}
          >
            <Plus className="size-4" aria-hidden />
          </Button>
          <Button
            type="button"
            size="icon"
            variant={editMode && !addingDevice ? 'secondary' : 'ghost'}
            className="size-8"
            aria-label={editMode ? 'Exit device edit mode' : 'Edit devices'}
            aria-pressed={editMode && !addingDevice}
            onClick={toggleEditMode}
          >
            <Pencil className="size-4" aria-hidden />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label="Refresh device list"
            onClick={() => void refreshDevices()}
          >
            <RefreshCw className="size-4" aria-hidden />
          </Button>
        </div>
      </div>

      <Tabs
        value={tabsValue}
        onValueChange={(value) => selectDevice(value)}
      >
        <TabsList className="h-auto min-h-9 w-full flex-wrap justify-start gap-1 p-1">
          {devices.map((d) => (
            <TabsTrigger
              key={d.id}
              value={d.id}
              className="h-8 max-w-full px-2.5 text-xs sm:text-sm"
            >
              <span className="truncate">{listDisplayName(d)}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {!editMode && liveTone && selectedDevice ? (
        <div className="rounded-lg border border-border/80 bg-muted/15 p-4">
          <DeviceQuickSettings
            device={selectedDevice}
            brightness={liveTone.brightness}
            gamma={liveTone.gamma}
            targetFps={defaultFps}
            busy={quickSettingsBusyOrTone}
            onToneCommit={(masterBrightness, masterGamma) => {
              void setMasterTone(masterBrightness, masterGamma)
            }}
            onFpsCommit={commitQuickFps}
          />
        </div>
      ) : null}

      {editMode ? (
        <div
          ref={editCardRef}
          className="rounded-lg border border-border/80 bg-muted/15 p-4"
        >
          {addingDevice ? (
            <>
              <p className="mb-3 text-sm font-medium text-muted-foreground">New device</p>
              <DeviceEditForm
                formKey="create"
                draft={createDraft}
                catalog={catalog}
                layoutLabel={layoutLabel}
                saveBusy={saveBusy}
                canDelete={false}
                showScan
                scanBusy={scanBusy}
                discovered={discovered}
                onScanLan={() => void scanLan()}
                onPickDiscovered={(esp) => setCreateDraft((d) => applyDiscovered(d, esp))}
                onChange={(patch) => setCreateDraft((d) => ({ ...d, ...patch }))}
                onSave={() => void saveCreate()}
                onCancel={exitEditMode}
                onDelete={() => {}}
                toneDisabled={saveBusy}
                onToneCommit={(masterBrightness, masterGamma) => {
                  setCreateDraft((d) => ({ ...d, masterBrightness, masterGamma }))
                }}
              />
            </>
          ) : selectedDevice && editDraft ? (
            <DeviceEditForm
              formKey={`edit-${selectedDevice.id}`}
              draft={editDraft}
              catalog={catalog}
              layoutLabel={layoutLabel}
              saveBusy={saveBusy}
              canDelete={devices.length > 1}
              showScan={false}
              scanBusy={scanBusy}
              discovered={discovered}
              onScanLan={() => void scanLan()}
              onPickDiscovered={() => {}}
              onChange={(patch) => setEditDraft((d) => (d ? { ...d, ...patch } : d))}
              onToneCommit={(masterBrightness, masterGamma) => {
                setEditDraft((d) => (d ? { ...d, masterBrightness, masterGamma } : d))
                void setMasterTone(masterBrightness, masterGamma)
              }}
              onSave={() => void saveEdit()}
              onCancel={exitEditMode}
              onDelete={() => void removeDevice()}
              toneDisabled={saveBusy || masterToneBusy}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Select a device to edit.</p>
          )}
        </div>
      ) : null}
    </div>
  )
}
