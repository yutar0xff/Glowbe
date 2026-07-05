import { Check, Loader2, Library, Radio, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { CompiledLayoutSummary, DiscoveredEsp } from '@/types'
import { isUserChainProfile } from '@/chain-editor/chain-profile-utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DeviceOutputSettingsRow } from './DeviceOutputSettingsRow'
import { LayoutMismatchAlert } from './LayoutMismatchAlert'
import { type DeviceDraft, parseDraftFps } from './device-draft'

function profileRowLabel(row: CompiledLayoutSummary, layoutLabel: (id: string) => string) {
  const name = layoutLabel(row.layoutId)
  const gpio = row.gpios?.length ?? row.dataLineCount
  const gpioHint = gpio != null ? `${gpio} line${gpio === 1 ? '' : 's'}` : null
  const ledHint = `${row.ledCount} LED${row.ledCount === 1 ? '' : 's'}`
  return gpioHint ? `${name} · ${ledHint} · ${gpioHint}` : `${name} · ${ledHint}`
}

function ChainProfileSelect({
  formKey,
  draft,
  catalog,
  layoutLabel,
  onChange,
}: {
  formKey: string
  draft: DeviceDraft
  catalog: CompiledLayoutSummary[]
  layoutLabel: (id: string) => string
  onChange: (patch: Partial<DeviceDraft>) => void
}) {
  const presets = catalog.filter((r) => !isUserChainProfile(r))
  const custom = catalog.filter((r) => isUserChainProfile(r))
  const selected = catalog.find((r) => r.layoutId === draft.layoutId)

  return (
    <>
      <Select value={draft.layoutId} onValueChange={(value) => onChange({ layoutId: value })}>
        <SelectTrigger id={`${formKey}-layout`} className="w-full font-mono text-xs">
          <SelectValue placeholder="Select chain profile" />
        </SelectTrigger>
        <SelectContent>
          {presets.length > 0 ? (
            <SelectGroup>
              <SelectLabel>Presets</SelectLabel>
              {presets.map((row) => (
                <SelectItem key={row.layoutId} value={row.layoutId} className="font-mono text-xs">
                  {profileRowLabel(row, layoutLabel)}
                </SelectItem>
              ))}
            </SelectGroup>
          ) : null}
          {custom.length > 0 ? (
            <SelectGroup>
              <SelectLabel>Custom</SelectLabel>
              {custom.map((row) => (
                <SelectItem key={row.layoutId} value={row.layoutId} className="font-mono text-xs">
                  {profileRowLabel(row, layoutLabel)}
                </SelectItem>
              ))}
            </SelectGroup>
          ) : null}
        </SelectContent>
      </Select>
      {selected ? (
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">{selected.layoutId}</p>
      ) : null}
    </>
  )
}

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
  layoutMismatch,
  expectedLayoutHash,
  espLayoutHash,
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
  layoutMismatch?: boolean
  expectedLayoutHash?: number | null
  espLayoutHash?: number | null
  onScanLan: () => void
  onPickDiscovered: (esp: DiscoveredEsp) => void
  onChange: (patch: Partial<DeviceDraft>) => void
  onSave: () => void
  onCancel: () => void
  onDelete: () => void
  toneDisabled?: boolean
  onToneCommit: (brightness: number, gamma: number) => void
}) {
  const returnQuery = '?returnTo=device'

  return (
    <div className="space-y-3 px-0 py-0" data-device-edit-form>
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
          <Label htmlFor={`${formKey}-layout`}>Chain profile</Label>
          <div className="flex w-full items-start gap-2">
            <div className="min-w-0 flex-1">
              {catalog && catalog.length > 0 ? (
                <ChainProfileSelect
                  formKey={formKey}
                  draft={draft}
                  catalog={catalog}
                  layoutLabel={layoutLabel}
                  onChange={onChange}
                />
              ) : (
                <Input
                  id={`${formKey}-layout`}
                  className="font-mono text-xs"
                  value={draft.layoutId}
                  onChange={(e) => onChange({ layoutId: e.target.value })}
                />
              )}
            </div>
            <Button type="button" variant="outline" size="sm" className="shrink-0" asChild>
              <Link to={`/chain-profiles${returnQuery}`}>
                <Library className="size-3.5" aria-hidden />
                Profile management
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {layoutMismatch ? (
        <LayoutMismatchAlert
          layoutId={draft.layoutId}
          expectedLayoutHash={expectedLayoutHash}
          espLayoutHash={espLayoutHash}
          compact
        />
      ) : null}

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
