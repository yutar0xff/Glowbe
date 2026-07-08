import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, Loader2, Upload } from 'lucide-react'
import { ClipPlacementSpherePreview } from '@/components/ClipPlacementSpherePreview'
import { NumberSliderRow } from '@/components/NumberSliderRow'
import { StudioNav } from '@/components/StudioNav'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  createClipFromSource,
  fetchSources,
  pollClipJob,
  previewPlacementFrame,
  sourceFrameUrl,
  uploadSource,
} from '@/lib/clip-api'
import { STUDIO_PAGE_CLASS } from '@/lib/studio-shell'
import type { ClipPlacement, SourceSummary } from '@/types'
import { useGlowbeRuntime } from '@/GlowbeRuntimeContext'

const STEPS = ['Source', 'Thumbnail', 'Placement', 'Create'] as const

const DEFAULT_PLACEMENT: ClipPlacement = {
  mode: 'equirect-planar',
  centerU: 0.5,
  centerV: 0.5,
  yawDeg: 0,
  pitchDeg: 0,
  scale: 1,
  rollDeg: 0,
  sourceAspect: 1,
}

/** Equirect preview resolution (2:1). */
const EQUIRECT_PREVIEW_W = 1024
const EQUIRECT_PREVIEW_H = 512

function uvFromYawPitch(yawDeg: number, pitchDeg: number): { u: number; v: number } {
  const pitch = (Math.max(-90, Math.min(90, pitchDeg)) * Math.PI) / 180
  const yaw = (yawDeg * Math.PI) / 180
  const lam = -yaw
  const cp = Math.cos(pitch)
  const x = cp * Math.cos(lam)
  const y = Math.sin(pitch)
  const z = cp * Math.sin(lam)
  const u = (Math.atan2(z, x) / (2 * Math.PI) + 0.5) % 1
  const v = 0.5 - Math.asin(Math.max(-1, Math.min(1, y))) / Math.PI
  return { u: u < 0 ? u + 1 : u, v }
}

function yawPitchFromUv(u: number, v: number): { yawDeg: number; pitchDeg: number } {
  const lam = 2 * Math.PI * (((u % 1) + 1) % 1) - Math.PI
  const pitch = Math.PI / 2 - Math.PI * Math.max(0, Math.min(1, v))
  const yawDeg = (-lam * 180) / Math.PI
  const pitchDeg = (pitch * 180) / Math.PI
  return { yawDeg, pitchDeg }
}

export function ClipCreatePage() {
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const { refreshLoad } = useGlowbeRuntime()
  const initialSourceId = search.get('sourceId')

  const [step, setStep] = useState(0)
  const [sources, setSources] = useState<SourceSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [sourceId, setSourceId] = useState<string | null>(initialSourceId)
  const [thumbFrame, setThumbFrame] = useState(0)
  const [placement, setPlacement] = useState<ClipPlacement>(DEFAULT_PLACEMENT)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [fps, setFps] = useState('30')
  const [displayName, setDisplayName] = useState('')
  const [createBusy, setCreateBusy] = useState(false)
  const [createProgress, setCreateProgress] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const previewRevRef = useRef(0)

  const selectedSource = useMemo(
    () => sources.find((s) => s.id === sourceId) ?? null,
    [sources, sourceId],
  )

  const isPlanar = placement.mode === 'equirect-planar'

  const refreshSources = useCallback(async () => {
    setErr(null)
    try {
      const list = await fetchSources()
      setSources(list)
      if (sourceId && !list.some((s) => s.id === sourceId)) {
        setSourceId(null)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [sourceId])

  useEffect(() => {
    void refreshSources()
  }, [refreshSources])

  const placementSourceIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!sourceId || !selectedSource || selectedSource.id !== sourceId) return
    const aspect = selectedSource.width / Math.max(1, selectedSource.height)
    if (placementSourceIdRef.current !== sourceId) {
      placementSourceIdRef.current = sourceId
      setPlacement({ ...DEFAULT_PLACEMENT, sourceAspect: aspect })
      return
    }
    setPlacement((p) => (p.sourceAspect === aspect ? p : { ...p, sourceAspect: aspect }))
  }, [sourceId, selectedSource])

  useEffect(() => {
    if (!sourceId || step < 2 || !selectedSource) return
    const rev = ++previewRevRef.current
    const timer = window.setTimeout(() => {
      void (async () => {
        setPreviewBusy(true)
        try {
          const url = await previewPlacementFrame(sourceId, thumbFrame, placement, {
            width: EQUIRECT_PREVIEW_W,
            height: EQUIRECT_PREVIEW_H,
          })
          if (previewRevRef.current !== rev) {
            URL.revokeObjectURL(url)
            return
          }
          setPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev)
            return url
          })
        } catch (e) {
          if (previewRevRef.current === rev) {
            setErr(e instanceof Error ? e.message : String(e))
          }
        } finally {
          if (previewRevRef.current === rev) setPreviewBusy(false)
        }
      })()
    }, 300)
    return () => window.clearTimeout(timer)
  }, [sourceId, thumbFrame, placement, step, selectedSource])

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    },
    [previewUrl],
  )

  const maxThumbFrame = useMemo(() => {
    if (!selectedSource) return 0
    if (selectedSource.kind === 'equirectangular-video') return 9999
    return Math.max(0, selectedSource.frameCount - 1)
  }, [selectedSource])

  const patchPlacement = (patch: Partial<ClipPlacement>) => {
    setPlacement((p) => {
      const next = { ...p, ...patch }
      if (patch.mode && patch.mode !== p.mode) {
        if (patch.mode === 'stereographic') {
          const { yawDeg, pitchDeg } = yawPitchFromUv(next.centerU, next.centerV)
          next.yawDeg = yawDeg
          next.pitchDeg = pitchDeg
        } else if (patch.mode === 'equirect-planar') {
          const { u, v } = uvFromYawPitch(next.yawDeg, next.pitchDeg)
          next.centerU = u
          next.centerV = v
        }
      }
      return next
    })
  }

  const onUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    void (async () => {
      setErr(null)
      setLoading(true)
      try {
        const id = await uploadSource(f)
        await refreshSources()
        setSourceId(id)
        setStep(1)
      } catch (uploadErr) {
        setErr(uploadErr instanceof Error ? uploadErr.message : String(uploadErr))
      } finally {
        setLoading(false)
      }
    })()
  }

  const onCreate = () => {
    if (!sourceId) return
    const fpsNum = Number.parseInt(fps, 10)
    if (!Number.isFinite(fpsNum) || fpsNum < 1 || fpsNum > 120) {
      setErr('FPS must be between 1 and 120.')
      return
    }
    void (async () => {
      setCreateBusy(true)
      setCreateProgress(0)
      setErr(null)
      try {
        const { jobId } = await createClipFromSource({
          sourceId,
          thumbFrameIndex: thumbFrame,
          placement,
          fps: fpsNum,
          displayName: displayName.trim() || undefined,
        })
        await pollClipJob(jobId, setCreateProgress)
        await refreshLoad()
        navigate('/clips')
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      } finally {
        setCreateBusy(false)
      }
    })()
  }

  const canNext =
    (step === 0 && sourceId != null) ||
    (step === 1 && selectedSource != null) ||
    (step === 2 && selectedSource != null) ||
    step === 3

  return (
    <main className={STUDIO_PAGE_CLASS}>
      <div className="mx-auto w-full max-w-5xl px-4 pt-10 md:px-6 md:pt-14">
        <header className="mb-8 space-y-3">
          <Button type="button" variant="ghost" size="sm" asChild className="-ml-2 w-fit">
            <Link to="/clips">
              <ArrowLeft className="size-4" aria-hidden />
              Clip editor
            </Link>
          </Button>
          <p className="font-mono text-xs font-bold tracking-[0.2em] text-cyan-400 uppercase">Clip creation</p>
          <h1 className="font-heading text-4xl font-extrabold tracking-tight md:text-5xl">New clip</h1>
          <StudioNav />
        </header>

        <ol className="mb-8 flex flex-wrap gap-2 text-sm">
          {STEPS.map((label, i) => (
            <li
              key={label}
              className={`rounded-full px-3 py-1 ${
                i === step
                  ? 'bg-primary text-primary-foreground'
                  : i < step
                    ? 'bg-muted text-foreground'
                    : 'bg-muted/40 text-muted-foreground'
              }`}
            >
              {i < step ? <Check className="mr-1 inline size-3.5" aria-hidden /> : null}
              {label}
            </li>
          ))}
        </ol>

        {err ? (
          <p className="mb-4 text-sm text-destructive" role="alert">
            {err}
          </p>
        ) : null}

        {step === 0 ? (
          <Card className="border-border/80 shadow-none">
            <CardHeader>
              <CardTitle>Select source</CardTitle>
              <CardDescription>Choose an existing source or upload a new file.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,.jpg,.jpeg,.zip,application/zip,video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.mkv"
                className="sr-only"
                onChange={onUpload}
              />
              <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()} disabled={loading}>
                <Upload className="size-4" aria-hidden />
                Upload new source
              </Button>
              {loading ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Loading sources…
                </p>
              ) : sources.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sources yet. Upload a file to continue.</p>
              ) : (
                <div className="grid gap-2">
                  {sources.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSourceId(s.id)}
                      className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                        sourceId === s.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'
                      }`}
                    >
                      <img
                        src={sourceFrameUrl(s.id, 0)}
                        alt=""
                        className="aspect-[2/1] w-24 rounded object-cover"
                      />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{s.displayName?.trim() || s.id}</p>
                        <p className="text-xs text-muted-foreground">
                          {s.kind} · {s.width}×{s.height}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}

        {step === 1 && selectedSource ? (
          <Card className="border-border/80 shadow-none">
            <CardHeader>
              <CardTitle>Thumbnail frame</CardTitle>
              <CardDescription>
                Pick the frame shown in clip lists (stored on the source, not re-baked).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <img
                src={sourceFrameUrl(selectedSource.id, thumbFrame)}
                alt="Source frame preview"
                className="aspect-[2/1] w-full max-w-lg rounded-lg border border-border object-contain"
              />
              <NumberSliderRow
                id="thumb-frame"
                label="Frame index"
                min={0}
                max={maxThumbFrame}
                step={1}
                value={Math.min(thumbFrame, maxThumbFrame)}
                onCommit={(v) => setThumbFrame(Math.round(v))}
              />
            </CardContent>
          </Card>
        ) : null}

        {step === 2 && selectedSource ? (
          <Card className="border-border/80 shadow-none">
            <CardHeader>
              <CardTitle>Placement</CardTitle>
              <CardDescription>
                {isPlanar
                  ? 'Planar patch on the equirectangular map. Preview in 2D and on the sphere.'
                  : 'Stereographic patch on the sphere. Adjust placement and preview on the 3D globe.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-wrap gap-2">
                {(['equirect-planar', 'stereographic'] as const).map((mode) => (
                  <Button
                    key={mode}
                    type="button"
                    variant={placement.mode === mode ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => patchPlacement({ mode })}
                  >
                    {mode === 'equirect-planar' ? 'Planar patch' : 'Stereographic'}
                  </Button>
                ))}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {isPlanar ? (
                  <>
                    <NumberSliderRow
                      id="placement-center-u"
                      label="Center U"
                      min={0}
                      max={1}
                      step={0.01}
                      value={placement.centerU}
                      onCommit={(v) => patchPlacement({ centerU: v })}
                    />
                    <NumberSliderRow
                      id="placement-center-v"
                      label="Center V"
                      min={0}
                      max={1}
                      step={0.01}
                      value={placement.centerV}
                      onCommit={(v) => patchPlacement({ centerV: v })}
                    />
                  </>
                ) : (
                  <>
                    <NumberSliderRow
                      id="placement-yaw"
                      label="Yaw"
                      unit="°"
                      min={-180}
                      max={180}
                      step={1}
                      value={placement.yawDeg}
                      onCommit={(v) => patchPlacement({ yawDeg: v })}
                    />
                    <NumberSliderRow
                      id="placement-pitch"
                      label="Pitch"
                      unit="°"
                      min={-90}
                      max={90}
                      step={1}
                      value={placement.pitchDeg}
                      onCommit={(v) => patchPlacement({ pitchDeg: v })}
                    />
                  </>
                )}
                <NumberSliderRow
                  id="placement-scale"
                  label="Scale"
                  min={0.05}
                  max={4}
                  step={0.01}
                  value={placement.scale}
                  onCommit={(v) => patchPlacement({ scale: v })}
                />
                <NumberSliderRow
                  id="placement-roll"
                  label="Roll"
                  unit="°"
                  min={-180}
                  max={180}
                  step={1}
                  value={placement.rollDeg}
                  onCommit={(v) => patchPlacement({ rollDeg: v })}
                />
              </div>

              <div className={isPlanar ? 'grid gap-6 lg:grid-cols-2' : 'space-y-3'}>
                {isPlanar ? (
                  <div className="relative min-w-0 space-y-2">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Equirect (2D)
                    </p>
                    <div className="relative overflow-hidden rounded-xl border border-border bg-[#0a0a0f]">
                      {previewBusy ? (
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
                          <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
                        </div>
                      ) : null}
                      {previewUrl ? (
                        <img
                          src={previewUrl}
                          alt="Equirectangular placement preview"
                          className="aspect-[2/1] w-full object-contain"
                        />
                      ) : (
                        <div className="flex aspect-[2/1] items-center justify-center text-sm text-muted-foreground">
                          2D preview will appear here
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                <div className="min-w-0 space-y-2">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Sphere (3D)
                  </p>
                  <div className="relative">
                    {previewBusy ? (
                      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background/40">
                        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
                      </div>
                    ) : null}
                    <ClipPlacementSpherePreview textureUrl={previewUrl} />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {step === 3 && selectedSource ? (
          <Card className="border-border/80 shadow-none">
            <CardHeader>
              <CardTitle>Create clip</CardTitle>
              <CardDescription>Server bakes all frames with the chosen placement.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="clip-fps" className="font-mono text-xs font-semibold">
                  FPS
                </Label>
                <Input
                  id="clip-fps"
                  inputMode="numeric"
                  value={fps}
                  onChange={(e) => setFps(e.target.value)}
                  disabled={createBusy}
                  className="max-w-xs font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="clip-name" className="font-mono text-xs font-semibold">
                  Display name (optional)
                </Label>
                <Input
                  id="clip-name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  disabled={createBusy}
                  placeholder="e.g. Lobby loop"
                  className="font-mono text-sm"
                />
              </div>
              {createBusy ? (
                <p className="text-sm text-muted-foreground">Converting… {createProgress}%</p>
              ) : null}
              <Button type="button" onClick={onCreate} disabled={createBusy}>
                {createBusy ? 'Creating…' : 'Create clip'}
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <div className="mt-6 flex justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0 || createBusy}
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button type="button" onClick={() => setStep((s) => s + 1)} disabled={!canNext || createBusy}>
              Next
              <ArrowRight className="size-4" aria-hidden />
            </Button>
          ) : null}
        </div>
      </div>
    </main>
  )
}
