import { useCallback, useEffect, useState } from 'react'
import { fetchMatePresets } from '@/api'
import { DEFAULT_MATE_BREATHING } from './constants'
import type { MateBreathingParams, MatePresetSummary } from './types'

export function useMatePresets(activeDeviceId: string | null, mateSupported: boolean) {
  const [presets, setPresets] = useState<MatePresetSummary[]>([])
  const [activePresetId, setActivePresetId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [breathing, setBreathing] = useState<MateBreathingParams>(DEFAULT_MATE_BREATHING)

  const reload = useCallback(async () => {
    if (!mateSupported) return
    setLoading(true)
    setError(null)
    const controller = new AbortController()
    try {
      const body = await fetchMatePresets(controller.signal, activeDeviceId)
      setPresets(body.presets)
      setActivePresetId(body.matePresetId ?? null)
      setBreathing(body.mateBreathing ?? DEFAULT_MATE_BREATHING)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [activeDeviceId, mateSupported])

  useEffect(() => {
    void reload()
  }, [reload])

  return {
    presets,
    activePresetId,
    setActivePresetId,
    loading,
    error,
    breathing,
    setBreathing,
  }
}
