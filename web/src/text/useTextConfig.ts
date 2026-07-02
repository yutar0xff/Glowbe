import { useCallback, useEffect, useState } from 'react'
import { fetchTextConfig } from '@/api'
import { DEFAULT_TEXT_PARAMS } from './constants'
import type { TextModeParams } from './types'

/** Loads the device's current text mode params from the runtime. */
export function useTextConfig(activeDeviceId: string | null) {
  const [params, setParams] = useState<TextModeParams>(DEFAULT_TEXT_PARAMS)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    const controller = new AbortController()
    try {
      const body = await fetchTextConfig(controller.signal, activeDeviceId)
      setParams(body)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [activeDeviceId])

  useEffect(() => {
    void reload()
  }, [reload])

  return { params, setParams, loading, error, reload }
}
