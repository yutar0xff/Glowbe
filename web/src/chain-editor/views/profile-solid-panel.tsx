import { Copy, Loader2, Pencil, Trash2 } from 'lucide-react'
import {
  canDeleteChainProfile,
  canEditChainProfile,
  isUserChainProfile,
} from '@/chain-editor/chain-profile-utils'
import { useChainProfileEditor } from '@/chain-editor/chain-profile-editor-context'
import { Field, panelButtonClass, selectClass } from '@/chain-editor/views/panel-ui'
import type { CompiledLayoutSummary } from '@/types'

function profileOptionLabel(row: CompiledLayoutSummary) {
  const name = row.displayName?.trim() || row.layoutId
  const gpio = row.gpios?.length ?? row.dataLineCount
  const gpioHint = gpio != null ? `${gpio} lines` : null
  const ledHint = `${row.ledCount} LEDs`
  return gpioHint ? `${name} · ${ledHint} · ${gpioHint}` : `${name} · ${ledHint}`
}

export function ProfileSolidPanel() {
  const editor = useChainProfileEditor()
  if (!editor) return null

  const {
    isDraft,
    layoutId,
    selectedProfileId,
    catalog,
    profileActionBusy,
    profileActionError,
    isPresetLocked,
    onSelectProfile,
    onEditProfile,
    onDuplicateProfile,
    onDeleteProfile,
  } = editor

  const presets = catalog.filter((r) => !isUserChainProfile(r))
  const custom = catalog.filter((r) => isUserChainProfile(r))
  const selected = catalog.find((r) => r.layoutId === selectedProfileId)
  const canDelete = canDeleteChainProfile(selected)
  const canEdit = canEditChainProfile(selected)
  const editingCurrent = !isDraft && layoutId === selectedProfileId

  return (
    <div className="flex flex-col gap-2">
      <Field label="Chain profile">
        <select
          value={selectedProfileId}
          onChange={(e) => onSelectProfile(e.target.value)}
          disabled={profileActionBusy}
          className={selectClass}
        >
          {presets.length > 0 ? (
            <optgroup label="Presets">
              {presets.map((row) => (
                <option key={row.layoutId} value={row.layoutId}>
                  {profileOptionLabel(row)}
                </option>
              ))}
            </optgroup>
          ) : null}
          {custom.length > 0 ? (
            <optgroup label="Custom">
              {custom.map((row) => (
                <option key={row.layoutId} value={row.layoutId}>
                  {profileOptionLabel(row)}
                </option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </Field>
      {selected ? (
        <p className="font-mono text-[10px] text-muted-foreground">{selected.layoutId}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {editingCurrent ? (
          <span className="rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] text-foreground">
            Editing this profile
          </span>
        ) : (
          <button
            type="button"
            className={panelButtonClass}
            disabled={profileActionBusy || !canEdit}
            onClick={() => onEditProfile(selectedProfileId)}
          >
            {profileActionBusy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Pencil className="size-3.5" aria-hidden />
            )}
            Edit
          </button>
        )}
        <button
          type="button"
          className={panelButtonClass}
          disabled={profileActionBusy || !selectedProfileId}
          onClick={() => onDuplicateProfile(selectedProfileId)}
        >
          {profileActionBusy ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Copy className="size-3.5" aria-hidden />
          )}
          Duplicate
        </button>
        <button
          type="button"
          className={panelButtonClass}
          disabled={profileActionBusy || !canDelete}
          onClick={() => onDeleteProfile(selectedProfileId)}
        >
          {profileActionBusy ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Trash2 className="size-3.5" aria-hidden />
          )}
          Delete
        </button>
      </div>
      {selected?.inUseByDevices?.length ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          In use by {selected.inUseByDevices.length} device
          {selected.inUseByDevices.length === 1 ? '' : 's'}. Unassign before delete.
        </p>
      ) : null}
      {isPresetLocked ? (
        <p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-200">
          Preset values are locked. Use Duplicate to create an editable custom profile.
        </p>
      ) : null}
      {isDraft ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Pick a preset to start a new custom profile, or open an existing custom profile to edit.
        </p>
      ) : null}
      {profileActionError ? (
        <p className="text-[11px] text-destructive">{profileActionError}</p>
      ) : null}
    </div>
  )
}
