import { resolveGlowbeWsUrl } from '@/api'

const TARGET_RATE = 48_000

function downsampleMono(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input
  const ratio = fromRate / toRate
  const outLen = Math.max(1, Math.floor(input.length / ratio))
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio
    const i0 = Math.floor(src)
    const i1 = Math.min(input.length - 1, i0 + 1)
    const t = src - i0
    out[i] = input[i0]! * (1 - t) + input[i1]! * t
  }
  return out
}

function encodeF32Le(samples: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(samples.length * 4)
  const view = new DataView(buf)
  for (let i = 0; i < samples.length; i++) {
    view.setFloat32(i * 4, samples[i]!, true)
  }
  return buf
}

export type IngestTap = {
  stop: () => void
}

/**
 * Keep display-capture video alive so Chrome does not tear down tab audio when
 * Studio is backgrounded. Draws to an off-DOM canvas on a timer.
 */
function attachDisplayVideoKeepAlive(stream: MediaStream): () => void {
  const videoTracks = stream.getVideoTracks()
  if (videoTracks.length === 0) return () => {}

  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.autoplay = true
  video.setAttribute('playsinline', '')
  video.style.position = 'fixed'
  video.style.width = '1px'
  video.style.height = '1px'
  video.style.opacity = '0'
  video.style.pointerEvents = 'none'
  video.style.left = '-10px'
  video.style.top = '-10px'
  video.srcObject = new MediaStream(videoTracks)
  document.body.appendChild(video)

  const canvas = document.createElement('canvas')
  canvas.width = 16
  canvas.height = 16
  const ctx2d = canvas.getContext('2d')

  let timer = 0
  const pump = () => {
    if (ctx2d && video.readyState >= 2) {
      try {
        ctx2d.drawImage(video, 0, 0, canvas.width, canvas.height)
      } catch {
        /* ignore draw errors while track restarts */
      }
    }
  }
  void video.play().catch(() => {
    /* autoplay can fail briefly; interval still retries when frames arrive */
  })
  // Prefer interval over rAF: background tabs throttle rAF to ~0.
  timer = window.setInterval(pump, 200)
  pump()

  return () => {
    window.clearInterval(timer)
    video.pause()
    video.srcObject = null
    video.remove()
  }
}

/**
 * Tap a MediaStream or HTMLMediaElement, downmix to mono, and send f32 LE PCM
 * to Runtime `/api/v1/ws/audio-ingest`. For tab capture, keep Studio silent and
 * hold AudioContext alive across backgrounding.
 */
export async function startIngestTap(
  source: MediaStream | HTMLMediaElement,
  opts?: { silentOutput?: boolean },
): Promise<IngestTap> {
  const silentOutput = opts?.silentOutput ?? source instanceof MediaStream
  const ctx = new AudioContext({ latencyHint: 'interactive' })
  const ws = new WebSocket(resolveGlowbeWsUrl(null, '/api/v1/ws/audio-ingest'))
  ws.binaryType = 'arraybuffer'

  await new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error('audio ingest WS timeout')), 8000)
    ws.onopen = () => {
      window.clearTimeout(t)
      resolve()
    }
    ws.onerror = () => {
      window.clearTimeout(t)
      reject(new Error('audio ingest WS failed'))
    }
  })

  const ensureRunning = () => {
    if (ctx.state === 'suspended') {
      void ctx.resume()
    }
  }
  ensureRunning()

  const srcNode =
    source instanceof MediaStream
      ? ctx.createMediaStreamSource(source)
      : ctx.createMediaElementSource(source)

  // ScriptProcessor is deprecated but widely available without worklet bundling.
  // Keep a silent branch so the processor stays in the graph; route audible output
  // separately — ScriptProcessor output is silence unless we copy buffers.
  const bufferSize = 2048
  const processor = ctx.createScriptProcessor(bufferSize, 2, 2)
  const silent = ctx.createGain()
  silent.gain.value = 0

  processor.onaudioprocess = (ev) => {
    if (ws.readyState !== WebSocket.OPEN) return
    const input = ev.inputBuffer
    const channels = input.numberOfChannels
    const frames = input.length
    const mono = new Float32Array(frames)
    for (let c = 0; c < channels; c++) {
      const data = input.getChannelData(c)
      for (let i = 0; i < frames; i++) {
        mono[i]! += data[i]! / channels
      }
    }
    const pcm = downsampleMono(mono, ctx.sampleRate, TARGET_RATE)
    ws.send(encodeF32Le(pcm))
  }

  srcNode.connect(processor)
  processor.connect(silent)
  silent.connect(ctx.destination)

  const playGain = ctx.createGain()
  playGain.gain.value = silentOutput ? 0 : 1
  if (!silentOutput) {
    srcNode.connect(playGain)
    playGain.connect(ctx.destination)
  }

  // Near-silent keep-alive so Chrome is less eager to suspend this tab's AudioContext.
  const keepOsc = ctx.createOscillator()
  const keepGain = ctx.createGain()
  keepGain.gain.value = 0.00001
  keepOsc.frequency.value = 20
  keepOsc.connect(keepGain)
  keepGain.connect(ctx.destination)
  keepOsc.start()

  try {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'playing'
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'Glowbe audio ingest',
        artist: 'Glowbe Studio',
      })
    }
  } catch {
    /* Media Session is optional */
  }

  const releaseVideoKeepAlive =
    source instanceof MediaStream ? attachDisplayVideoKeepAlive(source) : () => {}

  const onVisibility = () => ensureRunning()
  const onFocus = () => ensureRunning()
  const onStateChange = () => ensureRunning()
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('focus', onFocus)
  ctx.addEventListener('statechange', onStateChange)
  const resumeTimer = window.setInterval(ensureRunning, 1500)

  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    window.clearInterval(resumeTimer)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('focus', onFocus)
    ctx.removeEventListener('statechange', onStateChange)
    releaseVideoKeepAlive()
    try {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'none'
      }
    } catch {
      /* ignore */
    }
    try {
      keepOsc.stop()
      keepOsc.disconnect()
      keepGain.disconnect()
      processor.disconnect()
      srcNode.disconnect()
      silent.disconnect()
      playGain.disconnect()
    } catch {
      /* ignore */
    }
    void ctx.close()
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close()
    }
    if (source instanceof MediaStream) {
      for (const t of source.getTracks()) t.stop()
    }
  }

  ws.onclose = () => {
    if (!stopped) stop()
  }

  if (source instanceof MediaStream) {
    for (const t of source.getTracks()) {
      t.addEventListener('ended', () => {
        if (!stopped) stop()
      })
    }
  }

  return { stop }
}

export function tabCaptureSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function'
}

export async function captureTabAudioStream(): Promise<MediaStream> {
  if (!tabCaptureSupported()) {
    throw new Error('Tab audio capture is not supported in this browser (use desktop Chrome).')
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({
    // Tiny video constraints; video must stay alive for reliable background tab audio.
    video: {
      frameRate: { ideal: 5, max: 15 },
      width: { ideal: 320, max: 640 },
      height: { ideal: 180, max: 360 },
    },
    audio: true,
  })
  if (stream.getAudioTracks().length === 0) {
    for (const t of stream.getTracks()) t.stop()
    throw new Error('No audio track — select a tab and enable “Share tab audio”.')
  }
  // Keep video tracks: stopping them makes Chrome end capture when Studio is backgrounded.
  return stream
}
