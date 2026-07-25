/**
 * App-level tab-audio ingest session.
 * Survives AudioVisualizerModePanel unmount (e.g. device switch) so capture is not dropped.
 */

import {
  captureTabAudioStream,
  startIngestTap,
  tabCaptureSupported,
  type IngestTap,
} from '@/audio/ingestTap'

type Listener = () => void

let tap: IngestTap | null = null
let capturing = false
let startPromise: Promise<void> | null = null
const listeners = new Set<Listener>()

function notify() {
  for (const l of listeners) l()
}

function clearTap() {
  tap?.stop()
  tap = null
}

export function isTabIngestCapturing(): boolean {
  return capturing
}

export function tabIngestSupported(): boolean {
  return tabCaptureSupported()
}

export function subscribeTabIngest(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function stopTabIngest(): void {
  startPromise = null
  clearTap()
  if (capturing) {
    capturing = false
    notify()
  }
}

export async function startTabIngest(): Promise<void> {
  if (startPromise) {
    await startPromise
    return
  }
  const run = (async () => {
    clearTap()
    const stream = await captureTabAudioStream()
    tap = await startIngestTap(stream, { silentOutput: true })
    capturing = true
    notify()
  })()
  startPromise = run
  try {
    await run
  } catch (e) {
    clearTap()
    capturing = false
    notify()
    throw e
  } finally {
    if (startPromise === run) startPromise = null
  }
}
