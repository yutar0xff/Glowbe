import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import type { LoadState, OutputMode, RuntimeState } from '@/types'
import { API_BASE, fetchState, POLL_MS } from '@/api'
import { GlowbeRuntimeContext } from '@/GlowbeRuntimeContext'

export function GlowbeRuntimeProvider({ children }: { children: ReactNode }) {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' })
  const [modeBusy, setModeBusy] = useState<string | null>(null)
  const [sequenceBusy, setSequenceBusy] = useState<string | null>(null)
  const [masterToneBusy, setMasterToneBusy] = useState(false)

  useEffect(() => {
    let active = true
    let timer: number | undefined

    const tick = async () => {
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), 3500)
      try {
        const next = await fetchState(controller.signal)
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
  }, [])

  const setMode = useCallback(async (mode: OutputMode) => {
    setModeBusy(mode)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 3500)
    try {
      const res = await fetch(`${API_BASE}/api/v1/mode`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode }),
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`Could not change output mode (error ${res.status}).`)
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
          sequences: [],
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
  }, [])

  const selectSequence = useCallback(async (sequenceId: string) => {
    setSequenceBusy(sequenceId)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 3500)
    try {
      const res = await fetch(`${API_BASE}/api/v1/loop/select`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sequenceId }),
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`Could not select sequence (error ${res.status}).`)
      const newState = (await res.json()) as RuntimeState
      setLoad((prev) => {
        if (prev.kind === 'ready') {
          return { ...prev, state: newState, fetchedAt: new Date() }
        }
        return {
          kind: 'ready',
          state: newState,
          health: { ok: true, text: 'ok' },
          sequences: [],
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
      setSequenceBusy(null)
    }
  }, [])

  const setMasterTone = useCallback(async (brightness: number, gamma: number) => {
    setMasterToneBusy(true)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 3500)
    try {
      const res = await fetch(`${API_BASE}/api/v1/master-tone`, {
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
  }, [])

  const value = useMemo(
    () => ({
      load,
      modeBusy,
      sequenceBusy,
      masterToneBusy,
      setMode,
      selectSequence,
      setMasterTone,
    }),
    [load, modeBusy, sequenceBusy, masterToneBusy, setMode, selectSequence, setMasterTone],
  )

  return <GlowbeRuntimeContext.Provider value={value}>{children}</GlowbeRuntimeContext.Provider>
}
