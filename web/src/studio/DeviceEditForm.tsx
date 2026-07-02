import { Check, Loader2, Radio, Trash2 } from 'lucide-react'
import type { CompiledLayoutSummary, DiscoveredEsp } from '@/types'
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
import { DeviceOutputSettingsRow } from './DeviceOutputSettingsRow'
import { type DeviceDraft, parseDraftFps } from './device-draft'

export function DeviceEditForm({
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
  draft: DeviceDraft
  catalog: CompiledLayoutSummary[] | null
  layoutLabel: (id: string) => string
  saveBusy: boolean
  canDelete: boolean
  showScan: boolean
  scanBusy: boolean
  discovered: DiscoveredEsp[]
  onScanLan: () => void
  onPickDiscovered: (esp: DiscoveredEsp) => void
  onChange: (patch: Partial<DeviceDraft>) => void
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
        frontYawDeg={draft.frontYawDeg}
        disabled={toneDisabled}
        onFpsCommit={(value) => onChange({ outputFps: String(value) })}
        onToneCommit={onToneCommit}
        onFrontYawCommit={(deg) => onChange({ frontYawDeg: deg })}
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
