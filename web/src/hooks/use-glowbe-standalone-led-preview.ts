import { useEffect, useRef, useState } from 'react'
import { resolveGlowbeWsUrl } from '@/api'
import { parsePreviewRgbFrame } from '@/lib/preview-frame'

/**
 * Dedicated WebSocket with `previewSubscribe` (separate from Interactive/Mate sockets).
 * When `enabled` is false, no connection is opened.
 */
export function useGlowbeStandaloneLedPreview(
  enabled: boolean,
  ledCount: number,
  deviceId?: string | null,
) {
  const bufRef = useRef<Uint8Array | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!enabled || ledCount <= 0) {
      bufRef.current = null
      setRevision(0)
      return
    }

    let cancelled = false
    const ws = new WebSocket(resolveGlowbeWsUrl(deviceId))
    ws.binaryType = 'arraybuffer'

    ws.onopen = () => {
      if (cancelled) return
      ws.send(JSON.stringify({ type: 'previewSubscribe', enable: true }))
    }

    ws.onmessage = (ev) => {
      if (cancelled || typeof ev.data === 'string') return
      const parsed = parsePreviewRgbFrame(ev.data as ArrayBuffer)
      if (!parsed || parsed.rgb.length !== ledCount * 3) return
      const prev = bufRef.current
      if (prev?.length === parsed.rgb.length) {
        prev.set(parsed.rgb)
      } else {
        bufRef.current = new Uint8Array(parsed.rgb)
      }
      setRevision((n) => n + 1)
    }

    return () => {
      cancelled = true
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'previewSubscribe', enable: false }))
        } catch {
          /* ignore */
        }
      }
      ws.close()
      bufRef.current = null
    }
  }, [enabled, ledCount, deviceId])

  return { liveRgbBuf: bufRef, liveRgbRevision: revision }
}
