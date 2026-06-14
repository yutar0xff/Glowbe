import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { CalendarClock, Play, Pencil, Trash2, Upload } from 'lucide-react'
import { LiveMetricsRow } from '@/components/LiveMetricsRow'
import { formatDate } from '@/format'
import { API_BASE } from '@/api'
import { useGlowbeRuntime } from '@/GlowbeRuntimeContext'
import type { RuntimeState, SequenceSummary } from '@/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function sequenceThumbUrl(sequenceId: string): string {
  return `${API_BASE}/api/v1/sequences/${encodeURIComponent(sequenceId)}/source-frame/0`
}

function SequenceGridCard({
  seq,
  playingSequenceId,
}: {
  seq: SequenceSummary
  playingSequenceId: string | null
}) {
  const { selectSequence, deleteSequence, sequenceBusy, setSequenceDisplayName } = useGlowbeRuntime()
  const [draft, setDraft] = useState(seq.displayName ?? '')
  const [saving, setSaving] = useState(false)
  const [renameErr, setRenameErr] = useState<string | null>(null)
  const [thumbErr, setThumbErr] = useState(false)

  useEffect(() => {
    setDraft(seq.displayName ?? '')
    setRenameErr(null)
    setThumbErr(false)
  }, [seq.id, seq.displayName])

  const title = seq.displayName?.trim() ? seq.displayName.trim() : seq.id

  const onSaveDisplayName = () => {
    void (async () => {
      setRenameErr(null)
      setSaving(true)
      try {
        await setSequenceDisplayName(seq.id, draft)
      } catch (e) {
        setRenameErr(e instanceof Error ? e.message : String(e))
      } finally {
        setSaving(false)
      }
    })()
  }

  const onDelete = () => {
    if (!window.confirm(`Delete sequence “${title}” from disk? This cannot be undone.`)) return
    void deleteSequence(seq.id)
  }

  return (
    <Card className="flex flex-col overflow-hidden border-border/80 shadow-none">
      <div className="relative aspect-[2/1] w-full bg-muted/40">
        {!thumbErr ? (
          <img
            src={sequenceThumbUrl(seq.id)}
            alt=""
            className="size-full object-cover"
            onError={() => setThumbErr(true)}
          />
        ) : (
          <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
            No thumbnail
          </div>
        )}
        {playingSequenceId === seq.id ? (
          <span className="absolute left-2 top-2 rounded bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
            Playing
          </span>
        ) : null}
      </div>
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="space-y-1">
          <h3 className="truncate text-sm font-semibold tracking-tight" title={title}>
            {title}
          </h3>
          {seq.displayName?.trim() ? (
            <p className="truncate font-mono text-[10px] text-muted-foreground">id: {seq.id}</p>
          ) : null}
          <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
            {seq.frameCount} fr · {seq.fps} fps · {seq.sourceWidth}×{seq.sourceHeight}
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">{seq.sourceKind}</p>
          <p className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
            <CalendarClock className="size-3 shrink-0" aria-hidden />
            {formatDate(seq.createdAtUnixSec)}
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
            <Pencil className="size-2.5" aria-hidden />
            Label
          </label>
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Display name"
            className="h-8 font-mono text-xs"
            disabled={saving || sequenceBusy !== null}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-full text-xs"
            onClick={onSaveDisplayName}
            disabled={saving || sequenceBusy !== null}
          >
            {saving ? 'Saving…' : 'Save label'}
          </Button>
        </div>
        {renameErr ? (
          <p className="text-[10px] text-destructive" role="alert">
            {renameErr}
          </p>
        ) : null}

        <div className="mt-auto flex gap-2">
          <Button
            type="button"
            className="h-9 flex-1 gap-1 text-xs"
            onClick={() => void selectSequence(seq.id)}
            disabled={sequenceBusy !== null || playingSequenceId === seq.id}
          >
            <Play className="size-3.5 shrink-0" aria-hidden />
            {sequenceBusy === seq.id
              ? '…'
              : playingSequenceId === seq.id
                ? 'Active'
                : 'Play'}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className="h-9 shrink-0"
            aria-label="Delete sequence"
            onClick={onDelete}
            disabled={sequenceBusy !== null}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function LoopSourcePreview({
  sequenceId,
  frameIndex,
}: {
  sequenceId: string
  frameIndex: number
}) {
  const [err, setErr] = useState(false)
  const url = `${API_BASE}/api/v1/sequences/${encodeURIComponent(sequenceId)}/source-frame/${frameIndex}`

  if (err) {
    return (
      <p className="text-xs text-muted-foreground">
        Could not load source frame (older sequences may lack copied import media).
      </p>
    )
  }

  return (
    <img
      src={url}
      alt="Current sequence equirectangular source frame"
      className="aspect-[2/1] w-full max-w-4xl rounded-lg border border-border bg-black/40 object-contain"
      onError={() => setErr(true)}
    />
  )
}

export function LoopModePanel({
  state,
  sequences,
}: {
  state: RuntimeState
  sequences: SequenceSummary[]
}) {
  const {
    uploadMediaFile,
    convertMediaUpload,
    mediaUploadBusy,
    mediaConvertBusy,
    sequenceBusy,
  } = useGlowbeRuntime()
  const playingSequenceId = state.mode === 'loop' ? state.loopSequenceId : null
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
        await convertMediaUpload(lastUploadId, state.layoutId, fps, label || undefined)
        setLastUploadId(null)
        setSelectedFile(null)
      } catch (err) {
        setUploadErr(err instanceof Error ? err.message : String(err))
      }
    })()
  }

  const showSourcePreview =
    state.mode === 'loop' && playingSequenceId != null && state.loopSourceFrame != null

  return (
    <div className="space-y-6">
      <LiveMetricsRow state={state} />

      {showSourcePreview ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Source preview</CardTitle>
            <CardDescription>
              Equirectangular frame matching loop playback (frame {state.loopSourceFrame} of the
              selected sequence).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LoopSourcePreview sequenceId={playingSequenceId!} frameIndex={state.loopSourceFrame!} />
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
            Step 1: choose a file and upload it to the server. Step 2: convert that upload into a sequence for
            layout <span className="font-mono">{state.layoutId}</span>. Accepts{' '}
            <strong>PNG / JPEG</strong> (1 frame), <strong>ZIP</strong> of same-sized equirectangular PNG/JPEG (sorted
            by file name, max 3600 frames), or <strong>MP4 / WebM / MOV / MKV</strong> (server needs{' '}
            <span className="font-mono">ffmpeg</span>). After convert, the original file is copied into the sequence
            folder as <span className="font-mono">source-import.*</span> for previews — this is expected.
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
            <Button type="button" variant="secondary" onClick={onPickFile} disabled={sequenceBusy !== null}>
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
              disabled={!selectedFile || mediaUploadBusy || sequenceBusy !== null}
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
                disabled={mediaConvertBusy || sequenceBusy !== null}
              >
                {mediaConvertBusy ? 'Converting…' : 'Convert to sequence'}
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
            Sequences
          </CardTitle>
          <CardDescription>
            {sequences.length === 0
              ? 'No sequences loaded yet.'
              : `${sequences.length} available — grid shows first-frame thumbnail where possible.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {sequences.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Add sequences using the tooling described in the project README, upload and convert above, or run{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                cargo run --manifest-path runtime/Cargo.toml -- gen-demo-ripple-rings demo-ripple-rings config.toml
              </code>
              .
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {sequences.map((seq) => (
                <SequenceGridCard key={seq.id} seq={seq} playingSequenceId={playingSequenceId} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
