import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { CalendarClock, Pause, Play, Pencil, Sparkles, Square, Trash2, Upload } from 'lucide-react'
import { LayoutUvSheet } from '@/components/LayoutUvMap'
import { LayoutUvSphereCanvas } from '@/components/LayoutUvSphereCanvas'
import { formatDate } from '@/format'
import { API_BASE } from '@/api'
import { useGlowbeStandaloneLedPreview } from '@/hooks/use-glowbe-standalone-led-preview'
import { useLayoutUv } from '@/hooks/use-layout-uv'
import { useGlowbeRuntime } from '@/GlowbeRuntimeContext'
import type { ClipSummary, RuntimeState } from '@/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function clipThumbUrl(clip: ClipSummary): string | null {
  if (clip.isDemo) return null
  return `${API_BASE}/api/v1/clips/${encodeURIComponent(clip.id)}/source-frame/0`
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
  } = useGlowbeRuntime()
  const loopPlaybackPaused = load.kind === 'ready' && load.state.loopPlaybackPaused
  const isDemo = Boolean(clip.isDemo)
  const [draft, setDraft] = useState(clip.displayName ?? '')
  const [saving, setSaving] = useState(false)
  const [renameErr, setRenameErr] = useState<string | null>(null)
  const [thumbErr, setThumbErr] = useState(false)
  const [labelEditing, setLabelEditing] = useState(false)

  useEffect(() => {
    setDraft(clip.displayName ?? '')
    setRenameErr(null)
    setThumbErr(false)
    setLabelEditing(false)
  }, [clip.id, clip.displayName])

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
            {clip.frameCount} fr · {clip.fps} fps
            {clip.sourceWidth > 0 ? ` · ${clip.sourceWidth}×${clip.sourceHeight}` : ''}
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">
            {clip.sourceKind ?? clip.kind}
          </p>
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

function LoopSourcePreview({
  clipId,
  frameIndex,
}: {
  clipId: string
  frameIndex: number
}) {
  const [err, setErr] = useState(false)
  const url = `${API_BASE}/api/v1/clips/${encodeURIComponent(clipId)}/source-frame/${frameIndex}`

  if (err) {
    return (
      <p className="text-xs text-muted-foreground">
        Could not load source frame (built-in demos and some clips lack stored import media).
      </p>
    )
  }

  return (
    <img
      src={url}
      alt="Current clip equirectangular source frame"
      className="aspect-[2/1] w-full max-w-4xl rounded-lg border border-border bg-black/40 object-contain"
      onError={() => setErr(true)}
    />
  )
}

export function LoopModePanel({
  state,
  clips,
}: {
  state: RuntimeState
  clips: ClipSummary[]
}) {
  const {
    uploadMediaFile,
    convertMediaUpload,
    mediaUploadBusy,
    mediaConvertBusy,
    clipBusy,
    activeDeviceId,
  } = useGlowbeRuntime()
  const playingClipId = state.mode === 'loop' ? state.loopClipId : null
  const { uv, uvError, uvLoading } = useLayoutUv(state.layoutId, state.ledCount)
  const showSourcePreview =
    state.mode === 'loop' &&
    playingClipId != null &&
    !playingClipId.startsWith('demo/') &&
    state.loopSourceFrame != null
  const ledPreviewStream = Boolean(showSourcePreview && uv && !uvError)
  const { liveRgbBuf, liveRgbRevision } = useGlowbeStandaloneLedPreview(
    ledPreviewStream,
    state.ledCount,
    activeDeviceId,
  )
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [lastUploadId, setLastUploadId] = useState<string | null>(null)
  const [convertFps, setConvertFps] = useState('30')
  const [convertDisplayName, setConvertDisplayName] = useState('')

  const onPickFile = () => {
    setUploadErr(null)
    fileRef.current?.click()
  }

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setSelectedFile(f)
    setLastUploadId(null)
    setUploadErr(null)
  }

  const onUploadOnly = () => {
    if (!selectedFile) return
    void (async () => {
      setUploadErr(null)
      try {
        const { uploadId } = await uploadMediaFile(selectedFile)
        setLastUploadId(uploadId)
      } catch (err) {
        setUploadErr(err instanceof Error ? err.message : String(err))
      }
    })()
  }

  const onConvert = () => {
    if (!lastUploadId) return
    const fps = Number.parseInt(convertFps, 10)
    if (!Number.isFinite(fps) || fps < 1 || fps > 120) {
      setUploadErr('FPS must be between 1 and 120.')
      return
    }
    void (async () => {
      setUploadErr(null)
      try {
        const label = convertDisplayName.trim()
        await convertMediaUpload(lastUploadId, fps, label || undefined)
        setLastUploadId(null)
        setSelectedFile(null)
      } catch (err) {
        setUploadErr(err instanceof Error ? err.message : String(err))
      }
    })()
  }

  return (
    <div className="space-y-6">
      {showSourcePreview ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Source preview & live LEDs</CardTitle>
            <CardDescription>
              Top row: clip source frame and equirectangular LED map (frame {state.loopSourceFrame}). Bottom: 3D
              sphere with the same live RGB as sent to the device.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
              <div className="min-w-0 space-y-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Clip frame</p>
                <LoopSourcePreview clipId={playingClipId!} frameIndex={state.loopSourceFrame!} />
              </div>
              <div className="min-w-0 space-y-2">
                {uvLoading ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">Loading layout UV…</p>
                ) : uvError ? (
                  <p className="max-w-full break-words text-sm text-destructive" role="alert">
                    {uvError}
                  </p>
                ) : uv ? (
                  <>
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Equirect (2D)
                    </p>
                    <LayoutUvSheet
                      uv={uv}
                      disabled
                      pulseHighlights={[]}
                      liveLedRgb={liveRgbBuf.current}
                      liveLedRevision={liveRgbRevision}
                    />
                  </>
                ) : null}
              </div>
              {uv && !uvLoading && !uvError ? (
                <div className="min-w-0 space-y-2 lg:col-span-2">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Sphere (Three.js)
                  </p>
                  <LayoutUvSphereCanvas
                    uv={uv}
                    disabled={false}
                    pulseHighlights={[]}
                    liveLedRgb={liveRgbBuf.current ?? undefined}
                    onSphereTap={() => {}}
                  />
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Upload className="size-5 text-muted-foreground" aria-hidden />
            Upload equirectangular
          </CardTitle>
          <CardDescription>
            Step 1: choose a file and upload it to the server. Step 2: convert that upload into a layout-independent
            clip (default 256×128 equirect). Accepts <strong>PNG / JPEG</strong> (1 frame), <strong>ZIP</strong> of
            same-sized equirectangular PNG/JPEG (sorted by file name, max 3600 frames), or{' '}
            <strong>MP4 / WebM / MOV / MKV</strong> (server needs <span className="font-mono">ffmpeg</span>). After
            convert, the original file is copied into the clip folder as{' '}
            <span className="font-mono">source-import.*</span> for previews.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,.jpg,.jpeg,.zip,application/zip,video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.mkv"
            className="sr-only"
            onChange={onFileChange}
          />

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" onClick={onPickFile} disabled={clipBusy !== null}>
              Choose file
            </Button>
            {selectedFile ? (
              <span className="max-w-md truncate font-mono text-xs text-muted-foreground" title={selectedFile.name}>
                {selectedFile.name}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">No file selected</span>
            )}
            <Button
              type="button"
              onClick={onUploadOnly}
              disabled={!selectedFile || mediaUploadBusy || clipBusy !== null}
            >
              {mediaUploadBusy ? 'Uploading…' : 'Upload'}
            </Button>
          </div>

          {lastUploadId ? (
            <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
              <p className="font-mono text-xs text-muted-foreground">
                uploadId: <span className="text-foreground">{lastUploadId}</span>
              </p>
              <div className="grid max-w-md gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="glowbe-convert-fps" className="text-xs">
                    FPS
                  </Label>
                  <Input
                    id="glowbe-convert-fps"
                    inputMode="numeric"
                    value={convertFps}
                    onChange={(e) => setConvertFps(e.target.value)}
                    className="font-mono text-sm"
                    disabled={mediaConvertBusy}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="glowbe-convert-label" className="text-xs">
                    Display name (optional)
                  </Label>
                  <Input
                    id="glowbe-convert-label"
                    value={convertDisplayName}
                    onChange={(e) => setConvertDisplayName(e.target.value)}
                    placeholder="e.g. Sunset test"
                    className="font-mono text-sm"
                    disabled={mediaConvertBusy}
                  />
                </div>
              </div>
              <Button
                type="button"
                variant="default"
                onClick={onConvert}
                disabled={mediaConvertBusy || clipBusy !== null}
              >
                {mediaConvertBusy ? 'Converting…' : 'Convert to clip'}
              </Button>
            </div>
          ) : null}

          {uploadErr ? (
            <p className="text-sm text-destructive" role="alert">
              {uploadErr}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Play className="size-5 text-muted-foreground" aria-hidden />
            Clips
          </CardTitle>
          <CardDescription>
            {clips.length === 0
              ? 'No clips loaded yet.'
              : `${clips.length} available — built-in demos and uploaded media; thumbnails where possible.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {clips.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Upload and convert above, or use built-in demos such as{' '}
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
