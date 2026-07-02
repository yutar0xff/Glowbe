import { useCallback, useEffect, useRef, useState } from 'react'
import { Pencil, Plus, RefreshCw } from 'lucide-react'
import type { DeviceCreateInput } from '@/types'
import { fetchDiscoveredEsps } from '@/api'
import { useGlowbeRuntime } from '@/GlowbeRuntimeContext'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DeviceEditForm } from './DeviceEditForm'
import { DeviceOutputSettingsRow } from './DeviceOutputSettingsRow'
import {
  DEFAULT_MASTER_BRIGHTNESS,
  DEFAULT_MASTER_GAMMA,
  DEFAULT_OUTPUT_FPS,
  applyDiscoveredToDraft,
  editDraftFromRecord,
  emptyCreateDraft,
  listDisplayName,
  normalizeMdnsHostname,
  toRecord,
  type DeviceDraft,
} from './device-draft'
import { validateOutputFps } from './device-output-settings'
import { useLayoutCatalog } from './useLayoutCatalog'

function liveToneFromLoad(load: ReturnType<typeof useGlowbeRuntime>['load']) {
  if (load.kind !== 'ready') return null
  return { brightness: load.state.masterBrightness, gamma: load.state.masterGamma }
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
  const liveTone = liveToneFromLoad(load)
  const liveFrontYaw = load.kind === 'ready' ? load.state.frontYawDeg : undefined
  const { catalog, layoutLabel } = useLayoutCatalog()

  const [editMode, setEditMode] = useState(false)
  const [addingDevice, setAddingDevice] = useState(false)
  const [editDraft, setEditDraft] = useState<DeviceDraft | null>(null)
  const [createDraft, setCreateDraft] = useState<DeviceDraft>(() => emptyCreateDraft(layoutId, defaultFps))
  const [discovered, setDiscovered] = useState<Awaited<ReturnType<typeof fetchDiscoveredEsps>>>([])
  const [scanBusy, setScanBusy] = useState(false)
  const [saveBusy, setSaveBusy] = useState(false)
  const [quickSettingsBusy, setQuickSettingsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editCardRef = useRef<HTMLDivElement>(null)

  const selectedDevice = activeDeviceId ? devices.find((d) => d.id === activeDeviceId) : undefined
  const quickSettingsBusyOrTone = quickSettingsBusy || masterToneBusy

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
    const tone = liveToneFromLoad(load) ?? undefined
    setEditDraft((prev) => prev ?? editDraftFromRecord(selectedDevice, tone))
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

  const scanLan = useCallback(async () => {
    setScanBusy(true)
    setError(null)
    const controller = new AbortController()
    try {
      setDiscovered(await fetchDiscoveredEsps(controller.signal))
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
      setEditDraft(editDraftFromRecord(selectedDevice, liveTone ?? undefined))
    }
  }

  const selectDevice = (id: string) => {
    if (id === activeDeviceId) return
    setActiveDevice(id)
    setAddingDevice(false)
    if (editMode) {
      const rec = devices.find((d) => d.id === id)
      if (rec) setEditDraft(editDraftFromRecord(rec, liveTone ?? undefined))
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
      const fps = validateOutputFps(createDraft.outputFps)
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
        frontYawDeg: createDraft.frontYawDeg,
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

  const commitQuickFrontYaw = async (deg: number) => {
    if (!selectedDevice || deg === (selectedDevice.frontYawDeg ?? 0)) return
    setQuickSettingsBusy(true)
    setError(null)
    try {
      await updateDevice({
        ...selectedDevice,
        frontYawDeg: deg,
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

      <Tabs value={tabsValue} onValueChange={(value) => selectDevice(value)}>
        <TabsList className="h-auto min-h-9 w-full flex-wrap justify-start gap-1 p-1">
          {devices.map((d) => (
            <TabsTrigger key={d.id} value={d.id} className="h-8 max-w-full px-2.5 text-xs sm:text-sm">
              <span className="truncate">{listDisplayName(d)}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {!editMode && liveTone && selectedDevice ? (
        <div className="rounded-lg border border-border/80 bg-muted/15 p-4">
          <DeviceOutputSettingsRow
            idPrefix={`device-${selectedDevice.id}`}
            fps={defaultFps}
            brightness={liveTone.brightness}
            gamma={liveTone.gamma}
            frontYawDeg={liveFrontYaw ?? selectedDevice.frontYawDeg ?? 0}
            disabled={quickSettingsBusyOrTone}
            onFpsCommit={commitQuickFps}
            onToneCommit={(masterBrightness, masterGamma) => {
              void setMasterTone(masterBrightness, masterGamma)
            }}
            onFrontYawCommit={(deg) => {
              void commitQuickFrontYaw(deg)
            }}
          />
        </div>
      ) : null}

      {editMode ? (
        <div ref={editCardRef} className="rounded-lg border border-border/80 bg-muted/15 p-4">
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
                onPickDiscovered={(esp) => setCreateDraft((d) => applyDiscoveredToDraft(d, esp))}
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
