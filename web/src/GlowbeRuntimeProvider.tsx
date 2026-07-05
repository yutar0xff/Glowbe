import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import type { DeviceCreateInput, DeviceRecord, LoadState, MateBreathingParams, MediaUploadStatusPayload, OutputMode, RuntimeState, TextModeParams } from '@/types'
import {
  API_BASE,
  apiDeviceQuery,
  fetchDevices,
  fetchState,
  POLL_MS,
  postMateExpression,
  postMateBreathing,
  postMateTransition,
  postTextConfig,
  readActiveDeviceFromUrl,
  writeActiveDeviceToUrl,
} from '@/api'
import { GlowbeRuntimeContext } from '@/GlowbeRuntimeContext'

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

export function GlowbeRuntimeProvider({ children }: { children: ReactNode }) {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' })
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(() => readActiveDeviceFromUrl())
  const [devices, setDevices] = useState<DeviceRecord[]>([])
  const [modeBusy, setModeBusy] = useState<string | null>(null)
  const [clipBusy, setClipBusy] = useState<string | null>(null)
  const [layoutBusy, setLayoutBusy] = useState(false)
  const [masterToneBusy, setMasterToneBusy] = useState(false)
  const [mediaUploadBusy, setMediaUploadBusy] = useState(false)
  const [mediaConvertBusy, setMediaConvertBusy] = useState(false)
  const [mateExpressionBusy, setMateExpressionBusy] = useState<string | null>(null)
  const [mateBreathingBusy, setMateBreathingBusy] = useState(false)
  const [mateTransitionRotateBusy, setMateTransitionRotateBusy] = useState(false)
  const [textConfigBusy, setTextConfigBusy] = useState(false)

  const syncDevices = useCallback(async (signal: AbortSignal) => {
    const list = await fetchDevices(signal)
    setDevices(list.devices)
    let id = activeDeviceId ?? readActiveDeviceFromUrl()
    if (!id || !list.devices.some((d) => d.id === id)) {
      id = list.defaultDeviceId
      writeActiveDeviceToUrl(id)
      setActiveDeviceId(id)
    }
    return id
  }, [activeDeviceId])

  const refreshDevices = useCallback(async () => {
    const controller = new AbortController()
    try {
      await syncDevices(controller.signal)
    } catch (err) {
      console.warn('refreshDevices failed', err)
    }
  }, [syncDevices])

  const refreshLoad = useCallback(async () => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 3500)
    try {
      const deviceId = await syncDevices(controller.signal)
      const next = await fetchState(controller.signal, deviceId)
      setLoad(next)
    } catch (err) {
      setLoad({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
        fetchedAt: new Date(),
      })
    } finally {
      window.clearTimeout(timeout)
    }
  }, [syncDevices])

  const setActiveDevice = useCallback((deviceId: string | null) => {
    writeActiveDeviceToUrl(deviceId)
    setActiveDeviceId(deviceId)
  }, [])

  useEffect(() => {
    let active = true
    let timer: number | undefined

    const tick = async () => {
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), 3500)
      try {
        const deviceId = await syncDevices(controller.signal)
        const next = await fetchState(controller.signal, deviceId)
        if (active) setLoad(next)
      } catch (err) {
        if (active) {
          setLoad({
            kind: 'error',
            message: err instanceof Error ? err.message : String(err),
            fetchedAt: new Date(),
          })
        }
      } finally {
        window.clearTimeout(timeout)
        if (active) timer = window.setTimeout(tick, POLL_MS)
      }
    }

    tick()

    return () => {
      active = false
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [activeDeviceId, syncDevices])

  const setDeviceLayout = useCallback(async (layoutId: string) => {
    setLayoutBusy(true)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 3500)
    try {
      const q = apiDeviceQuery(activeDeviceId)
      const res = await fetch(`${API_BASE}/api/v1/device/layout${q}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ layoutId }),
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(await readApiError(res))
      const newState = (await res.json()) as RuntimeState
      setLoad((prev) => {
        if (prev.kind === 'ready') {
          return {
            ...prev,
            state: newState,
            fetchedAt: new Date(),
          }
        }
        return {
          kind: 'ready',
          state: newState,
          health: prev.kind === 'error' && prev.health ? prev.health : { ok: true, text: 'ok' },
          clips: [],
          fetchedAt: new Date(),
        }
      })
      await refreshLoad()
    } catch (err) {
      setLoad((prev) => ({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
        health: prev.kind === 'ready' || prev.kind === 'error' ? prev.health : undefined,
        fetchedAt: new Date(),
      }))
    } finally {
      window.clearTimeout(timeout)
      setLayoutBusy(false)
    }
  }, [refreshLoad, activeDeviceId])

  const setMode = useCallback(async (mode: OutputMode) => {
    setModeBusy(mode)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 3500)
    try {
      const q = apiDeviceQuery(activeDeviceId)
      const res = await fetch(`${API_BASE}/api/v1/mode${q}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode }),
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(await readApiError(res))
      const newState = (await res.json()) as RuntimeState
      setLoad((prev) => {
        if (prev.kind === 'ready') {
          return {
            ...prev,
            state: newState,
            fetchedAt: new Date(),
          }
        }
        return {
          kind: 'ready',
          state: newState,
          health: prev.kind === 'error' && prev.health ? prev.health : { ok: true, text: 'ok' },
          clips: [],
          fetchedAt: new Date(),
        }
      })
    } catch (err) {
      setLoad((prev) => ({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
        health: prev.kind === 'ready' || prev.kind === 'error' ? prev.health : undefined,
        fetchedAt: new Date(),
      }))
    } finally {
      window.clearTimeout(timeout)
      setModeBusy(null)
    }
  }, [activeDeviceId])

  const setMateExpression = useCallback(
    async (preset: string, transitionMs = 320) => {
      setMateExpressionBusy(preset)
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), 3500)
      try {
        const newState = await postMateExpression(
          controller.signal,
          activeDeviceId,
          preset,
          transitionMs,
        )
        setLoad((prev) => {
          if (prev.kind === 'ready') {
            return { ...prev, state: newState, fetchedAt: new Date() }
          }
          return {
            kind: 'ready',
            state: newState,
            health: { ok: true, text: 'ok' },
            clips: [],
            fetchedAt: new Date(),
          }
        })
      } catch (err) {
        setLoad((prev) => ({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
          health: prev.kind === 'ready' || prev.kind === 'error' ? prev.health : undefined,
          fetchedAt: new Date(),
        }))
        throw err
      } finally {
        window.clearTimeout(timeout)
        setMateExpressionBusy(null)
      }
    },
    [activeDeviceId],
  )

  const setMateBreathing = useCallback(
    async (params: Partial<MateBreathingParams> & { enabled: boolean }) => {
      setMateBreathingBusy(true)
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), 3500)
      try {
        const newState = await postMateBreathing(controller.signal, activeDeviceId, params)
        setLoad((prev) => {
          if (prev.kind === 'ready') {
            return { ...prev, state: newState, fetchedAt: new Date() }
          }
          return {
            kind: 'ready',
            state: newState,
            health: { ok: true, text: 'ok' },
            clips: [],
            fetchedAt: new Date(),
          }
        })
      } catch (err) {
        setLoad((prev) => ({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
          health: prev.kind === 'ready' || prev.kind === 'error' ? prev.health : undefined,
          fetchedAt: new Date(),
        }))
        throw err
      } finally {
        window.clearTimeout(timeout)
        setMateBreathingBusy(false)
      }
    },
    [activeDeviceId],
  )

  const setMateTransitionRotate = useCallback(
    async (rotate: boolean) => {
      setMateTransitionRotateBusy(true)
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), 3500)
      try {
        const newState = await postMateTransition(controller.signal, activeDeviceId, rotate)
        setLoad((prev) => {
          if (prev.kind === 'ready') {
            return { ...prev, state: newState, fetchedAt: new Date() }
          }
          return {
            kind: 'ready',
            state: newState,
            health: { ok: true, text: 'ok' },
            clips: [],
            fetchedAt: new Date(),
          }
        })
      } catch (err) {
        setLoad((prev) => ({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
          health: prev.kind === 'ready' || prev.kind === 'error' ? prev.health : undefined,
          fetchedAt: new Date(),
        }))
        throw err
      } finally {
        window.clearTimeout(timeout)
        setMateTransitionRotateBusy(false)
      }
    },
    [activeDeviceId],
  )

  const setTextConfig = useCallback(
    async (params: Partial<TextModeParams>) => {
      setTextConfigBusy(true)
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), 3500)
      try {
        const newState = await postTextConfig(controller.signal, activeDeviceId, params)
        setLoad((prev) => {
          if (prev.kind === 'ready') {
            return { ...prev, state: newState, fetchedAt: new Date() }
          }
          return {
            kind: 'ready',
            state: newState,
            health: { ok: true, text: 'ok' },
            clips: [],
            fetchedAt: new Date(),
          }
        })
      } catch (err) {
        setLoad((prev) => ({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
          health: prev.kind === 'ready' || prev.kind === 'error' ? prev.health : undefined,
          fetchedAt: new Date(),
        }))
        throw err
      } finally {
        window.clearTimeout(timeout)
        setTextConfigBusy(false)
      }
    },
    [activeDeviceId],
  )

  const clearLoopSelection = useCallback(async () => {
    setClipBusy('__clear__')
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 3500)
    try {
      const q = apiDeviceQuery(activeDeviceId)
      const res = await fetch(`${API_BASE}/api/v1/loop/clear-selection${q}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`Could not clear loop selection (error ${res.status}).`)
      const newState = (await res.json()) as RuntimeState
      setLoad((prev) => {
        if (prev.kind === 'ready') {
          return { ...prev, state: newState, fetchedAt: new Date() }
        }
        return {
          kind: 'ready',
          state: newState,
          health: { ok: true, text: 'ok' },
          clips: [],
          fetchedAt: new Date(),
        }
      })
    } catch (err) {
      setLoad((prev) => ({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
        health: prev.kind === 'ready' || prev.kind === 'error' ? prev.health : undefined,
        fetchedAt: new Date(),
      }))
    } finally {
      window.clearTimeout(timeout)
      setClipBusy(null)
    }
  }, [activeDeviceId])

  const setLoopPlaybackPaused = useCallback(async (paused: boolean) => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 3500)
    try {
      const q = apiDeviceQuery(activeDeviceId)
      const res = await fetch(`${API_BASE}/api/v1/loop/pause${q}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paused }),
        signal: controller.signal,
      })
      if (!res.ok) {
        throw new Error(`Could not ${paused ? 'pause' : 'resume'} loop playback (error ${res.status}).`)
      }
      const newState = (await res.json()) as RuntimeState
      setLoad((prev) => {
        if (prev.kind === 'ready') {
          return { ...prev, state: newState, fetchedAt: new Date() }
        }
        return prev
      })
    } catch (err) {
      setLoad((prev) => ({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
        health: prev.kind === 'ready' || prev.kind === 'error' ? prev.health : undefined,
        fetchedAt: new Date(),
      }))
    } finally {
      window.clearTimeout(timeout)
    }
  }, [activeDeviceId])

  const selectClip = useCallback(async (clipId: string) => {
    setClipBusy(clipId)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 3500)
    try {
      const q = apiDeviceQuery(activeDeviceId)
      const res = await fetch(`${API_BASE}/api/v1/loop/select${q}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clipId }),
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(await readApiError(res))
      const newState = (await res.json()) as RuntimeState
      setLoad((prev) => {
        if (prev.kind === 'ready') {
          return { ...prev, state: newState, fetchedAt: new Date() }
        }
        return {
          kind: 'ready',
          state: newState,
          health: { ok: true, text: 'ok' },
          clips: [],
          fetchedAt: new Date(),
        }
      })
    } catch (err) {
      setLoad((prev) => ({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
        health: prev.kind === 'ready' || prev.kind === 'error' ? prev.health : undefined,
        fetchedAt: new Date(),
      }))
    } finally {
      window.clearTimeout(timeout)
      setClipBusy(null)
    }
  }, [activeDeviceId])

  const setMasterTone = useCallback(async (brightness: number, gamma: number) => {
    setMasterToneBusy(true)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 3500)
    try {
      const q = apiDeviceQuery(activeDeviceId)
      const res = await fetch(`${API_BASE}/api/v1/master-tone${q}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brightness, gamma }),
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`Could not update master tone (error ${res.status}).`)
      const newState = (await res.json()) as RuntimeState
      setLoad((prev) => {
        if (prev.kind === 'ready') {
          return { ...prev, state: newState, fetchedAt: new Date() }
        }
        return prev
      })
    } catch (err) {
      console.warn('setMasterTone failed', err)
    } finally {
      window.clearTimeout(timeout)
      setMasterToneBusy(false)
    }
  }, [activeDeviceId])

  const upsertDevice = useCallback(async (input: DeviceCreateInput) => {
    const res = await fetch(`${API_BASE}/api/v1/devices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        displayName: input.displayName,
        espIp: input.espIp ?? null,
        mdnsHostname: input.mdnsHostname ?? null,
        layoutId: input.layoutId,
        outputFps: input.outputFps,
        masterBrightness: input.masterBrightness ?? 1,
        masterGamma: input.masterGamma ?? 1,
        frontYawDeg: input.frontYawDeg ?? 0,
      }),
    })
    if (!res.ok) throw new Error(await readApiError(res))
    const list = (await res.json()) as { devices: DeviceRecord[]; createdDeviceId?: string }
    setDevices(list.devices)
    return list.createdDeviceId
  }, [])

  const updateDevice = useCallback(async (record: DeviceRecord) => {
    const res = await fetch(`${API_BASE}/api/v1/devices/${encodeURIComponent(record.id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        displayName: record.displayName,
        espIp: record.espIp ?? null,
        mdnsHostname: record.mdnsHostname ?? null,
        layoutId: record.layoutId,
        outputFps: record.outputFps,
        masterBrightness: record.masterBrightness ?? 1,
        masterGamma: record.masterGamma ?? 1,
        frontYawDeg: record.frontYawDeg ?? 0,
      }),
    })
    if (!res.ok) throw new Error(await readApiError(res))
    const list = (await res.json()) as { devices: DeviceRecord[]; state?: RuntimeState }
    setDevices(list.devices)
    if (list.state) {
      setLoad((prev) => ({
        kind: 'ready',
        state: list.state as RuntimeState,
        health:
          prev.kind === 'ready' || prev.kind === 'error'
            ? (prev.health ?? { ok: true, text: 'ok' })
            : { ok: true, text: 'ok' },
        clips: prev.kind === 'ready' ? prev.clips : [],
        fetchedAt: new Date(),
      }))
      return
    }
    await refreshLoad()
  }, [refreshLoad])

  const deleteDevice = useCallback(async (deviceId: string) => {
    const res = await fetch(`${API_BASE}/api/v1/devices/${encodeURIComponent(deviceId)}`, {
      method: 'DELETE',
    })
    if (!res.ok) throw new Error(await readApiError(res))
  }, [])

  const uploadMediaFile = useCallback(async (file: File) => {
    setMediaUploadBusy(true)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 120_000)
    try {
      const form = new FormData()
      form.append('file', file)
      const up = await fetch(`${API_BASE}/api/v1/media/upload`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      })
      if (!up.ok) throw new Error(await readApiError(up))
      const { uploadId } = (await up.json()) as { uploadId: string }
      return { uploadId }
    } finally {
      window.clearTimeout(timeout)
      setMediaUploadBusy(false)
    }
  }, [])

  const convertMediaUpload = useCallback(
    async (uploadId: string, fps = 30, displayName?: string) => {
      setMediaConvertBusy(true)
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), 180_000)
      try {
        const dn = displayName?.trim()
        const conv = await fetch(
          `${API_BASE}/api/v1/media/${encodeURIComponent(uploadId)}/convert`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              fps,
              ...(dn ? { displayName: dn } : {}),
            }),
            signal: controller.signal,
          },
        )
        if (!conv.ok) throw new Error(await readApiError(conv))

        const deadline = Date.now() + 180_000
        for (;;) {
          if (Date.now() > deadline) throw new Error('Convert timed out waiting for completion.')
          await new Promise((r) => window.setTimeout(r, 400))
          const st = await fetch(`${API_BASE}/api/v1/media/${encodeURIComponent(uploadId)}`, {
            signal: controller.signal,
          })
          if (!st.ok) throw new Error(await readApiError(st))
          const j = (await st.json()) as MediaUploadStatusPayload
          if (j.status === 'done') break
          if (j.status === 'failed') throw new Error(j.error || 'Convert failed.')
        }

        await refreshLoad()
      } finally {
        window.clearTimeout(timeout)
        setMediaConvertBusy(false)
      }
    },
    [refreshLoad],
  )

  const setClipDisplayName = useCallback(
    async (clipId: string, displayName: string) => {
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), 3500)
      try {
        const res = await fetch(
          `${API_BASE}/api/v1/clips/${encodeURIComponent(clipId)}`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ displayName }),
            signal: controller.signal,
          },
        )
        if (!res.ok) throw new Error(await readApiError(res))
        await refreshLoad()
      } finally {
        window.clearTimeout(timeout)
      }
    },
    [refreshLoad],
  )

  const deleteClip = useCallback(
    async (clipId: string) => {
      setClipBusy(clipId)
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), 3500)
      try {
        const res = await fetch(
          `${API_BASE}/api/v1/clips/${encodeURIComponent(clipId)}`,
          {
            method: 'DELETE',
            signal: controller.signal,
          },
        )
        if (!res.ok) throw new Error(await readApiError(res))
        await refreshLoad()
      } catch (err) {
        setLoad((prev) => ({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
          health: prev.kind === 'ready' || prev.kind === 'error' ? prev.health : undefined,
          fetchedAt: new Date(),
        }))
      } finally {
        window.clearTimeout(timeout)
        setClipBusy(null)
      }
    },
    [refreshLoad],
  )

  const value = useMemo(
    () => ({
      load,
      activeDeviceId,
      devices,
      modeBusy,
      clipBusy,
      layoutBusy,
      masterToneBusy,
      mediaUploadBusy,
      mediaConvertBusy,
      mateExpressionBusy,
      mateBreathingBusy,
      mateTransitionRotateBusy,
      textConfigBusy,
      setMode,
      setMateExpression,
      setMateBreathing,
      setMateTransitionRotate,
      setTextConfig,
      selectClip,
      clearLoopSelection,
      setLoopPlaybackPaused,
      setMasterTone,
      uploadMediaFile,
      convertMediaUpload,
      setClipDisplayName,
      deleteClip,
      setDeviceLayout,
      refreshLoad,
      refreshDevices,
      setActiveDevice,
      upsertDevice,
      updateDevice,
      deleteDevice,
    }),
    [
      load,
      activeDeviceId,
      devices,
      modeBusy,
      clipBusy,
      layoutBusy,
      masterToneBusy,
      mediaUploadBusy,
      mediaConvertBusy,
      mateExpressionBusy,
      mateBreathingBusy,
      mateTransitionRotateBusy,
      textConfigBusy,
      setMode,
      setMateExpression,
      setMateBreathing,
      setMateTransitionRotate,
      setTextConfig,
      selectClip,
      clearLoopSelection,
      setLoopPlaybackPaused,
      setMasterTone,
      uploadMediaFile,
      convertMediaUpload,
      setClipDisplayName,
      deleteClip,
      setDeviceLayout,
      refreshLoad,
      refreshDevices,
      setActiveDevice,
      upsertDevice,
      updateDevice,
      deleteDevice,
    ],
  )

  return <GlowbeRuntimeContext.Provider value={value}>{children}</GlowbeRuntimeContext.Provider>
}
