import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, ExternalLink, Pause, Play, Pencil, Sparkles, Square, Trash2 } from 'lucide-react'
import { LayoutUvSphereCanvas } from '@/components/LayoutUvSphereCanvas'
import { NumberSliderRow } from '@/components/NumberSliderRow'
import { formatDate } from '@/format'
import { clipThumbnailUrl, patchClip } from '@/lib/clip-api'
import { useGlowbeStandaloneLedPreview } from '@/hooks/use-glowbe-standalone-led-preview'
import { useLayoutUv } from '@/hooks/use-layout-uv'
import { useGlowbeRuntime } from '@/GlowbeRuntimeContext'
import type { ClipSummary, RuntimeState } from '@/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ModeResetBar } from './ModeResetBar'

function clipThumbUrl(clip: ClipSummary): string | null {
  return clipThumbnailUrl(clip)
}

function ClipGridCard({
  clip,
  playingClipId,
}: {
  clip: ClipSummary
  playingClipId: string | null
}) {
  const {
    load,
    selectClip,
    deleteClip,
    clipBusy,
    setClipDisplayName,
    setLoopPlaybackPaused,
    clearLoopSelection,
    refreshLoad,
  } = useGlowbeRuntime()
  const loopPlaybackPaused = load.kind === 'ready' && load.state.loopPlaybackPaused
  const isDemo = Boolean(clip.isDemo)
  const [draft, setDraft] = useState(clip.displayName ?? '')
  const [gamma, setGamma] = useState(clip.gamma ?? 1)
  const [saving, setSaving] = useState(false)
  const [renameErr, setRenameErr] = useState<string | null>(null)
  const [thumbErr, setThumbErr] = useState(false)
  const [labelEditing, setLabelEditing] = useState(false)

  useEffect(() => {
    setDraft(clip.displayName ?? '')
    setGamma(clip.gamma ?? 1)
    setRenameErr(null)
    setThumbErr(false)
    setLabelEditing(false)
  }, [clip.id, clip.displayName, clip.gamma])

  const title = clip.displayName?.trim() ? clip.displayName.trim() : clip.id
  const thumbUrl = clipThumbUrl(clip)

  const onCancelLabelEdit = () => {
    setDraft(clip.displayName ?? '')
    setRenameErr(null)
    setLabelEditing(false)
  }

  const onSaveDisplayName = () => {
    void (async () => {
      setRenameErr(null)
      setSaving(true)
      try {
        await setClipDisplayName(clip.id, draft)
        setLabelEditing(false)
      } catch (e) {
        setRenameErr(e instanceof Error ? e.message : String(e))
      } finally {
        setSaving(false)
      }
    })()
  }

  const onCommitGamma = (v: number) => {
    if (isDemo) return
    setGamma(v)
    void (async () => {
      setRenameErr(null)
      try {
        await patchClip(clip.id, { gamma: v })
        await refreshLoad()
      } catch (e) {
        setRenameErr(e instanceof Error ? e.message : String(e))
        setGamma(clip.gamma ?? 1)
      }
    })()
  }

  const onDelete = () => {
    if (!window.confirm(`Delete clip “${title}” from disk? This cannot be undone.`)) return
    void deleteClip(clip.id)
  }

  return (
    <Card className="flex flex-col overflow-hidden border-border/80 shadow-none">
      <div className="relative aspect-[2/1] w-full bg-muted/40">
        {thumbUrl && !thumbErr ? (
          <img
            src={thumbUrl}
            alt=""
            className="size-full object-cover"
            onError={() => setThumbErr(true)}
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
            {isDemo ? (
              <>
                <Sparkles className="size-5 opacity-60" aria-hidden />
                Built-in demo
              </>
            ) : (
              'No thumbnail'
            )}
          </div>
        )}
        {playingClipId === clip.id ? (
          <span className="absolute left-2 top-2 rounded bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
            {loopPlaybackPaused ? 'Paused' : 'Playing'}
          </span>
        ) : null}
      </div>
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        {labelEditing && !isDemo ? (
          <div className="space-y-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Display name"
              className="h-8 font-mono text-xs"
              disabled={saving || clipBusy !== null}
              autoFocus
              aria-label="Clip display name"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                className="h-8 flex-1 text-xs"
                onClick={onSaveDisplayName}
                disabled={saving || clipBusy !== null}
              >
                {saving ? 'Saving…' : 'Save'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 flex-1 text-xs"
                onClick={onCancelLabelEdit}
                disabled={saving || clipBusy !== null}
              >
                Cancel
              </Button>
            </div>
            {renameErr ? (
              <p className="text-[10px] text-destructive" role="alert">
                {renameErr}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex min-w-0 items-start gap-1">
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight" title={title}>
              {title}
            </h3>
            {!isDemo ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setRenameErr(null)
                  setDraft(clip.displayName ?? '')
                  setLabelEditing(true)
                }}
                disabled={clipBusy !== null}
                aria-label="Edit label"
              >
                <Pencil className="size-3.5" aria-hidden />
              </Button>
            ) : null}
          </div>
        )}

        <div className="space-y-1">
          {clip.displayName?.trim() ? (
            <p className="truncate font-mono text-[10px] text-muted-foreground">id: {clip.id}</p>
          ) : null}
          <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
            {isDemo ? (
              `~${(clip.frameCount / Math.max(clip.fps, 1)).toFixed(1)}s loop · device fps`
            ) : (
              <>
                {clip.frameCount} fr · {clip.fps} fps
                {clip.sourceWidth > 0 ? ` · ${clip.sourceWidth}×${clip.sourceHeight}` : ''}
              </>
            )}
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">
            {clip.sourceKind ?? clip.kind}
          </p>
          {!isDemo ? (
            <NumberSliderRow
              id={`clip-gamma-${clip.id}`}
              label="Gamma"
              min={0.45}
              max={3.5}
              step={0.05}
              value={gamma}
              disabled={clipBusy !== null}
              onCommit={onCommitGamma}
            />
          ) : null}
          {clip.createdAtUnixSec > 0 ? (
            <p className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
              <CalendarClock className="size-3 shrink-0" aria-hidden />
              {formatDate(clip.createdAtUnixSec)}
            </p>
          ) : null}
        </div>

        <div className="mt-auto flex flex-col gap-2">
          {playingClipId === clip.id ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                className="h-9 min-h-9 flex-1 justify-center gap-0 px-3"
                onClick={() => void setLoopPlaybackPaused(!loopPlaybackPaused)}
                disabled={clipBusy !== null}
                aria-label={loopPlaybackPaused ? 'Resume' : 'Pause'}
              >
                {loopPlaybackPaused ? (
                  <Play className="size-4" aria-hidden />
                ) : (
                  <Pause className="size-4" aria-hidden />
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-9 min-h-9 flex-1 justify-center gap-0 px-3"
                onClick={() => void clearLoopSelection()}
                disabled={clipBusy !== null}
                aria-label="End playback"
              >
                <Square className="size-4" aria-hidden />
              </Button>
              {!isDemo ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="h-9 shrink-0"
                  aria-label="Delete clip"
                  onClick={onDelete}
                  disabled={clipBusy !== null}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="flex gap-2">
              <Button
                type="button"
                className="h-9 flex-1 gap-1 text-xs"
                onClick={() => void selectClip(clip.id)}
                disabled={clipBusy !== null}
              >
                <Play className="size-3.5 shrink-0" aria-hidden />
                {clipBusy === clip.id ? '…' : 'Play'}
              </Button>
              {!isDemo ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="h-9 shrink-0"
                  aria-label="Delete clip"
                  onClick={onDelete}
                  disabled={clipBusy !== null}
                >
                  <Trash2 className="size-4" />
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function LoopModePanel({
  state,
  clips,
}: {
  state: RuntimeState
  clips: ClipSummary[]
}) {
  const { clipBusy, activeDeviceId, clearLoopSelection, setLoopPlaybackPaused } = useGlowbeRuntime()
  const playingClipId = state.mode === 'loop' ? state.loopClipId : null
  const { uv, uvError, uvLoading } = useLayoutUv(state.layoutId, state.ledCount)
  const previewEnabled = state.mode === 'loop'
  const { liveRgbBuf } = useGlowbeStandaloneLedPreview(
    previewEnabled,
    state.ledCount,
    activeDeviceId,
  )
  const [resetBusy, setResetBusy] = useState(false)

  const resetToDefaults = async () => {
    setResetBusy(true)
    try {
      if (state.loopPlaybackPaused) {
        await setLoopPlaybackPaused(false)
      }
      await clearLoopSelection()
    } catch {
      /* surfaced via load error state in provider */
    } finally {
      setResetBusy(false)
    }
  }

  const loopBusy = resetBusy || clipBusy !== null

  return (
    <div className="space-y-6">
      <ModeResetBar onReset={resetToDefaults} busy={resetBusy} disabled={loopBusy && !resetBusy} />
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Live LEDs</CardTitle>
          <CardDescription>
            3D sphere preview of loop output (pre-tone RGB; device brightness and clip gamma are not applied).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {uvLoading ? (
            <p className="text-sm text-muted-foreground">Loading layout UV…</p>
          ) : uvError ? (
            <p className="max-w-full break-words text-sm text-destructive" role="alert">
              {uvError}
            </p>
          ) : uv ? (
            <LayoutUvSphereCanvas
              uv={uv}
              disabled={false}
              pulseHighlights={[]}
              liveLedRgb={liveRgbBuf.current ?? undefined}
              onSphereTap={() => {}}
              hint="Drag to orbit · live LED colors"
            />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Play className="size-5 text-muted-foreground" aria-hidden />
            Clips
          </CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-2">
            <span>
              {clips.length === 0
                ? 'No clips loaded yet.'
                : `${clips.length} available — select a clip to play in loop mode.`}
            </span>
            <Button type="button" variant="link" size="sm" className="h-auto p-0" asChild>
              <Link to="/clips">
                <ExternalLink className="size-3.5" aria-hidden />
                Clip editor
              </Link>
            </Button>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {clips.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Create clips in the{' '}
              <Link to="/clips" className="text-primary underline-offset-4 hover:underline">
                Clip editor
              </Link>
              , or use built-in demos such as{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">demo/expanding-rings</code>.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {clips.map((clip) => (
                <ClipGridCard key={clip.id} clip={clip} playingClipId={playingClipId} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
