import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { Film, Loader2, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { StudioAppChrome } from '@/components/StudioAppChrome'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NumberSliderRow } from '@/components/NumberSliderRow'
import { formatDate } from '@/format'
import { useGlowbeRuntime } from '@/GlowbeRuntimeContext'
import {
  clipThumbnailUrl,
  deleteSource,
  fetchSources,
  patchClip,
  patchSource,
  sourceFrameUrl,
  uploadSource,
} from '@/lib/clip-api'
import type { ClipSummary, SourceSummary } from '@/types'

function sourceLabel(s: SourceSummary): string {
  return s.displayName?.trim() || s.id
}

function clipLabel(c: ClipSummary): string {
  return c.displayName?.trim() || c.id
}

function SourceCard({
  source,
  onChanged,
}: {
  source: SourceSummary
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(source.displayName ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [thumbErr, setThumbErr] = useState(false)

  useEffect(() => {
    setDraft(source.displayName ?? '')
    setEditing(false)
    setThumbErr(false)
  }, [source.id, source.displayName])

  const onSave = () => {
    void (async () => {
      setBusy(true)
      setErr(null)
      try {
        await patchSource(source.id, draft)
        setEditing(false)
        onChanged()
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    })()
  }

  const onDelete = () => {
    if (!window.confirm(`Delete source “${sourceLabel(source)}”?`)) return
    void (async () => {
      setBusy(true)
      setErr(null)
      try {
        await deleteSource(source.id)
        onChanged()
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    })()
  }

  return (
    <Card className="flex flex-col overflow-hidden border-border/80 shadow-none">
      <div className="relative aspect-[2/1] w-full bg-muted/40">
        {!thumbErr ? (
          <img
            src={sourceFrameUrl(source.id, 0)}
            alt=""
            className="size-full object-cover"
            onError={() => setThumbErr(true)}
          />
        ) : (
          <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
            No preview
          </div>
        )}
      </div>
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        {editing ? (
          <div className="space-y-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="h-8 font-mono text-xs"
              disabled={busy}
              autoFocus
            />
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={onSave} disabled={busy}>
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft(source.displayName ?? '')
                  setEditing(false)
                }}
                disabled={busy}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="truncate font-medium">{sourceLabel(source)}</p>
            <p className="font-mono text-[10px] text-muted-foreground">{source.id}</p>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {source.kind} · {source.frameCount || 'video'} frame{source.frameCount === 1 ? '' : 's'} ·{' '}
          {source.width}×{source.height}
        </p>
        <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Film className="size-3" aria-hidden />
          {formatDate(source.createdAtUnixSec)}
        </p>
        {err ? (
          <p className="text-xs text-destructive" role="alert">
            {err}
          </p>
        ) : null}
        <div className="mt-auto flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" asChild>
            <Link to={`/clips/new?sourceId=${encodeURIComponent(source.id)}`}>Create clip</Link>
          </Button>
          {!editing ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
              disabled={busy}
            >
              <Pencil className="size-3.5" aria-hidden />
              Rename
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="destructive" onClick={onDelete} disabled={busy}>
            <Trash2 className="size-3.5" aria-hidden />
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function ClipCard({ clip, onChanged }: { clip: ClipSummary; onChanged: () => void }) {
  const { deleteClip, clipBusy } = useGlowbeRuntime()
  const isDemo = Boolean(clip.isDemo)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(clip.displayName ?? '')
  const [thumbIdx, setThumbIdx] = useState(String(clip.thumbFrameIndex ?? 0))
  const [gamma, setGamma] = useState(clip.gamma ?? 1)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [thumbErr, setThumbErr] = useState(false)
  const thumbUrl = clipThumbnailUrl(clip)

  useEffect(() => {
    setDraft(clip.displayName ?? '')
    setThumbIdx(String(clip.thumbFrameIndex ?? 0))
    setGamma(clip.gamma ?? 1)
    setEditing(false)
    setThumbErr(false)
  }, [clip.id, clip.displayName, clip.thumbFrameIndex, clip.gamma])

  const onSave = () => {
    void (async () => {
      setBusy(true)
      setErr(null)
      const idx = Number.parseInt(thumbIdx, 10)
      try {
        await patchClip(clip.id, {
          displayName: draft,
          gamma,
          ...(clip.sourceId && Number.isFinite(idx) ? { thumbFrameIndex: idx } : {}),
        })
        setEditing(false)
        onChanged()
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    })()
  }

  const onDelete = () => {
    if (!window.confirm(`Delete clip “${clipLabel(clip)}”?`)) return
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
          <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
            {isDemo ? 'Built-in demo' : 'No thumbnail'}
          </div>
        )}
      </div>
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        {editing && !isDemo ? (
          <div className="space-y-2">
            <Label className="text-xs">Display name</Label>
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="h-8 font-mono text-xs"
              disabled={busy}
            />
            {clip.sourceId ? (
              <>
                <Label className="text-xs">Thumbnail frame index</Label>
                <Input
                  value={thumbIdx}
                  onChange={(e) => setThumbIdx(e.target.value)}
                  inputMode="numeric"
                  className="h-8 font-mono text-xs"
                  disabled={busy}
                />
              </>
            ) : null}
            <NumberSliderRow
              id={`clip-edit-gamma-${clip.id}`}
              label="Gamma"
              min={0.45}
              max={3.5}
              step={0.05}
              value={gamma}
              disabled={busy}
              onCommit={setGamma}
            />
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={onSave} disabled={busy}>
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft(clip.displayName ?? '')
                  setThumbIdx(String(clip.thumbFrameIndex ?? 0))
                  setGamma(clip.gamma ?? 1)
                  setEditing(false)
                }}
                disabled={busy}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="truncate font-medium">{clipLabel(clip)}</p>
            <p className="font-mono text-[10px] text-muted-foreground">{clip.id}</p>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {clip.fps} fps · {clip.frameCount} frames · {clip.width}×{clip.height}
          {clip.sourceId ? (
            <>
              <br />
              Source: <span className="font-mono">{clip.sourceId}</span>
            </>
          ) : null}
        </p>
        {err ? (
          <p className="text-xs text-destructive" role="alert">
            {err}
          </p>
        ) : null}
        <div className="mt-auto flex flex-wrap gap-2">
          {!isDemo ? (
            <>
              <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)} disabled={busy || clipBusy !== null}>
                <Pencil className="size-3.5" aria-hidden />
                Edit
              </Button>
              {clip.sourceId ? (
                <Button type="button" size="sm" variant="secondary" asChild>
                  <Link to={`/clips/new?sourceId=${encodeURIComponent(clip.sourceId)}`}>Recreate</Link>
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="destructive"
                onClick={onDelete}
                disabled={clipBusy !== null}
              >
                <Trash2 className="size-3.5" aria-hidden />
                Delete
              </Button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Demo clips cannot be edited.</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function ClipEditorPage() {
  const { load, refreshLoad } = useGlowbeRuntime()
  const clips = load.kind === 'ready' ? load.clips : []
  const [sources, setSources] = useState<SourceSummary[]>([])
  const [loadingSources, setLoadingSources] = useState(true)
  const [sourceErr, setSourceErr] = useState<string | null>(null)
  const [uploadBusy, setUploadBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const refreshSources = useCallback(async () => {
    setSourceErr(null)
    try {
      setSources(await fetchSources())
    } catch (e) {
      setSourceErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingSources(false)
    }
  }, [])

  useEffect(() => {
    void refreshSources()
  }, [refreshSources])

  const onRefreshAll = () => {
    void refreshSources()
    void refreshLoad()
  }

  const onUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    void (async () => {
      setUploadBusy(true)
      setSourceErr(null)
      try {
        await uploadSource(f)
        await refreshSources()
      } catch (err) {
        setSourceErr(err instanceof Error ? err.message : String(err))
      } finally {
        setUploadBusy(false)
      }
    })()
  }

  return (
    <StudioAppChrome
      eyebrow="Clip management"
      description="Manage source media and layout-independent clips."
    >
      <section className="mb-12 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Sources</h2>
            <p className="text-sm text-muted-foreground">Original uploads used to create clips.</p>
          </div>
          <div className="flex gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,.jpg,.jpeg,.zip,application/zip,video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.mkv"
              className="sr-only"
              onChange={onUpload}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => fileRef.current?.click()}
              disabled={uploadBusy}
            >
              <Upload className="size-4" aria-hidden />
              {uploadBusy ? 'Uploading…' : 'Upload source'}
            </Button>
          </div>
        </div>
        {sourceErr ? (
          <p className="text-sm text-destructive" role="alert">
            {sourceErr}
          </p>
        ) : null}
        {loadingSources ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Loading sources…
          </div>
        ) : sources.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sources yet. Upload a PNG, ZIP sequence, or video.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {sources.map((s) => (
              <SourceCard key={s.id} source={s} onChanged={onRefreshAll} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Clips</h2>
            <p className="text-sm text-muted-foreground">Baked equirectangular sequences for loop playback.</p>
          </div>
          <Button type="button" asChild>
            <Link to="/clips/new">
              <Plus className="size-4" aria-hidden />
              New clip
            </Link>
          </Button>
        </div>
        {clips.length === 0 ? (
          <p className="text-sm text-muted-foreground">No clips yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {clips.map((c) => (
              <ClipCard key={c.id} clip={c} onChanged={onRefreshAll} />
            ))}
          </div>
        )}
      </section>
    </StudioAppChrome>
  )
}
