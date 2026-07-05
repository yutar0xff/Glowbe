import { CheckCircle2, Loader2, Save } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useChainProfileEditor } from '@/chain-editor/chain-profile-editor-context'
import { useEditorStore } from '@/chain-editor/stores/editor-store'
import { Section, Stat } from '@/chain-editor/views/panel-ui'

export function SaveFirmwareStep() {
  const editor = useChainProfileEditor()
  const rig = useEditorStore((s) => s.rig)

  if (!editor) return null

  const {
    isDraft,
    isPresetLocked,
    canSave,
    layoutId,
    displayName,
    setDisplayName,
    saveBusy,
    onSave,
    saveNotice,
    layoutHash,
    ledCount,
    returnTo,
    backHref,
  } = editor

  const ledDisplay = ledCount ?? rig.solid.faces.length

  return (
    <div className="flex h-full w-full flex-col gap-5 overflow-y-auto bg-background p-4">
      {isPresetLocked ? (
        <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-50">
          <AlertTitle>Preset template (read-only)</AlertTitle>
          <AlertDescription className="text-amber-900/90 dark:text-amber-100/90">
            Settings are locked to preset values. Use <strong>Duplicate</strong> on step 1 to create
            an editable custom profile, then save it here.
          </AlertDescription>
        </Alert>
      ) : null}

      <Section title="Save chain profile">
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="chain-display-name-step" className="text-xs">
              Display name
            </Label>
            <Input
              id="chain-display-name-step"
              className="h-8 max-w-md text-xs"
              value={displayName}
              disabled={isPresetLocked}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={!canSave || saveBusy}
            onClick={() => void onSave()}
          >
            {saveBusy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : saveNotice ? (
              <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />
            ) : (
              <Save className="size-4" aria-hidden />
            )}
            {saveNotice ? 'Saved' : isDraft ? 'Create custom profile' : 'Save changes'}
          </Button>
        </div>
        {isDraft && !isPresetLocked ? (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Saving creates a new custom profile from your current settings.
          </p>
        ) : null}
      </Section>

      {saveNotice ? (
        <Alert
          role="status"
          className="border-emerald-500/40 bg-emerald-500/10 text-emerald-950 dark:text-emerald-50"
        >
          <CheckCircle2 className="text-emerald-600 dark:text-emerald-400" aria-hidden />
          <AlertTitle>Chain profile saved</AlertTitle>
          <AlertDescription className="space-y-1 text-emerald-900/90 dark:text-emerald-100/90">
            <p className="font-mono text-xs">
              {saveNotice.ledCount} LEDs · {saveNotice.dataLineCount} data lines · hash{' '}
              <span className="text-foreground/90">
                0x{saveNotice.layoutHash.toString(16).padStart(8, '0')}
              </span>
            </p>
            <p>
              Source JSON and compiled artifacts (UV map, binary meta, firmware header) are updated.
              {returnTo === 'device' ? (
                <>
                  {' '}
                  <Link to={backHref} className="font-medium underline underline-offset-2">
                    Return to device settings
                  </Link>{' '}
                  to assign this profile.
                </>
              ) : (
                ' Select it on the device form when ready.'
              )}
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      <Section title="Firmware setup">
        <dl className="space-y-2 font-mono text-xs">
          <div>
            <dt className="text-muted-foreground">layoutId</dt>
            <dd>{layoutId ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">layoutHash</dt>
            <dd>{layoutHash != null ? `0x${layoutHash.toString(16).padStart(8, '0')}` : '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">GLOWBE_LED_COUNT</dt>
            <dd>{ledDisplay}</dd>
          </div>
        </dl>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          After saving, rebuild and flash firmware with the generated header for this profile:
        </p>
        <pre className="mt-2 overflow-x-auto rounded-md bg-muted/60 p-2 text-[10px]">
          {`cd firmware/esp32\nuv run pio run -e 60panels -t upload`}
        </pre>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Select this profile on the device form, then confirm STATUS{' '}
          <code className="text-foreground">layout_hash</code> matches after flash.
        </p>
      </Section>

      <div className="mt-auto rounded-md border border-border bg-card p-3 text-xs">
        <Stat label="Profile status" value={layoutId ? 'saved' : 'draft'} />
        <Stat label="LED count" value={ledDisplay} />
      </div>
    </div>
  )
}
