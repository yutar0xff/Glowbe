import { API_BASE } from '@/api'
import type { ClipPlacement, ClipSummary, SourceSummary } from '@/types'

async function readApiError(res: Response): Promise<string> {
  const t = await res.text()
  try {
    const j = JSON.parse(t) as { error?: string }
    if (j.error) return j.error
  } catch {
    /* plain text */
  }
  return t || `HTTP ${res.status}`
}

export function sourceFrameUrl(sourceId: string, frameIndex: number): string {
  return `${API_BASE}/api/v1/sources/${encodeURIComponent(sourceId)}/frame/${frameIndex}`
}

export function clipThumbnailUrl(clip: ClipSummary): string | null {
  if (clip.isDemo) return null
  if (clip.sourceId) {
    return `${API_BASE}/api/v1/clips/${encodeURIComponent(clip.id)}/thumbnail`
  }
  return `${API_BASE}/api/v1/clips/${encodeURIComponent(clip.id)}/source-frame/0`
}

export async function fetchSources(signal?: AbortSignal): Promise<SourceSummary[]> {
  const res = await fetch(`${API_BASE}/api/v1/sources`, { signal })
  if (!res.ok) throw new Error(await readApiError(res))
  return (await res.json()) as SourceSummary[]
}

export async function uploadSource(file: File, signal?: AbortSignal): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API_BASE}/api/v1/sources/upload`, {
    method: 'POST',
    body: form,
    signal,
  })
  if (!res.ok) throw new Error(await readApiError(res))
  const body = (await res.json()) as { sourceId: string }
  return body.sourceId
}

export async function patchSource(
  sourceId: string,
  displayName: string,
  signal?: AbortSignal,
): Promise<SourceSummary> {
  const res = await fetch(`${API_BASE}/api/v1/sources/${encodeURIComponent(sourceId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName }),
    signal,
  })
  if (!res.ok) throw new Error(await readApiError(res))
  return (await res.json()) as SourceSummary
}

export async function deleteSource(sourceId: string, signal?: AbortSignal): Promise<void> {
  const res = await fetch(`${API_BASE}/api/v1/sources/${encodeURIComponent(sourceId)}`, {
    method: 'DELETE',
    signal,
  })
  if (!res.ok) throw new Error(await readApiError(res))
}

export async function patchClip(
  clipId: string,
  patch: { displayName?: string; thumbFrameIndex?: number; gamma?: number },
  signal?: AbortSignal,
): Promise<ClipSummary> {
  const res = await fetch(`${API_BASE}/api/v1/clips/${encodeURIComponent(clipId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
    signal,
  })
  if (!res.ok) throw new Error(await readApiError(res))
  return (await res.json()) as ClipSummary
}

export type ClipCreateParams = {
  sourceId: string
  thumbFrameIndex: number
  placement: ClipPlacement
  fps: number
  displayName?: string
}

export type ClipJobStatus = {
  jobId: string
  status: 'running' | 'done' | 'failed' | 'queued'
  clipId?: string
  error?: string
  progress?: number
}

export async function createClipFromSource(
  params: ClipCreateParams,
  signal?: AbortSignal,
): Promise<{ jobId: string; clipId: string }> {
  const res = await fetch(`${API_BASE}/api/v1/clips/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sourceId: params.sourceId,
      thumbFrameIndex: params.thumbFrameIndex,
      placement: params.placement,
      fps: params.fps,
      ...(params.displayName?.trim() ? { displayName: params.displayName.trim() } : {}),
    }),
    signal,
  })
  if (!res.ok) throw new Error(await readApiError(res))
  const body = (await res.json()) as { jobId: string; clipId: string }
  return { jobId: body.jobId, clipId: body.clipId }
}

export async function fetchClipJob(jobId: string, signal?: AbortSignal): Promise<ClipJobStatus> {
  const res = await fetch(`${API_BASE}/api/v1/clips/jobs/${encodeURIComponent(jobId)}`, { signal })
  if (!res.ok) throw new Error(await readApiError(res))
  return (await res.json()) as ClipJobStatus
}

export async function pollClipJob(
  jobId: string,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  let lastProgress = 0
  for (;;) {
    const job = await fetchClipJob(jobId, signal)
    if (job.status === 'done' && job.clipId) return job.clipId
    if (job.status === 'failed') {
      throw new Error(job.error ?? 'Clip conversion failed')
    }
    if (job.progress != null) {
      lastProgress = Math.max(lastProgress, job.progress)
      onProgress?.(lastProgress)
    }
    await new Promise((r) => window.setTimeout(r, 500))
  }
}

export async function previewPlacementFrame(
  sourceId: string,
  frameIndex: number,
  placement: ClipPlacement,
  resolution?: { width: number; height: number },
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(`${API_BASE}/api/v1/clips/preview-frame`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sourceId,
      frameIndex,
      placement,
      ...(resolution
        ? { width: resolution.width, height: resolution.height }
        : {}),
    }),
    signal,
  })
  if (!res.ok) throw new Error(await readApiError(res))
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}
