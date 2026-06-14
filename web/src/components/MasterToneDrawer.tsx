import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useGlowbeRuntime } from '../GlowbeRuntimeContext'

const DEBOUNCE_MS = 200

export function MasterToneDrawer() {
  const { load, setMasterTone, masterToneBusy } = useGlowbeRuntime()
  const [open, setOpen] = useState(false)
  const [brightness, setBrightness] = useState(1)
  const [gamma, setGamma] = useState(1)
  const debounceRef = useRef<number | undefined>(undefined)

  const openDrawer = useCallback(() => {
    if (load.kind === 'ready') {
      setBrightness(load.state.masterBrightness)
      setGamma(load.state.masterGamma)
    }
    setOpen(true)
  }, [load])

  useEffect(() => {
    return () => {
      if (debounceRef.current !== undefined) window.clearTimeout(debounceRef.current)
    }
  }, [])

  const schedulePush = useCallback(
    (b: number, g: number) => {
      if (debounceRef.current !== undefined) window.clearTimeout(debounceRef.current)
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = undefined
        void setMasterTone(b, g)
      }, DEBOUNCE_MS)
    },
    [setMasterTone],
  )

  const onBrightness = (b: number) => {
    setBrightness(b)
    schedulePush(b, gamma)
  }

  const onGamma = (g: number) => {
    setGamma(g)
    schedulePush(brightness, g)
  }

  if (load.kind !== 'ready') return null

  return (
    <>
      <button
        type="button"
        className="header-gear-btn"
        onClick={openDrawer}
        disabled={masterToneBusy}
        aria-label="Master output settings"
        title="Master brightness & gamma (all modes)"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.52-.4-1.08-.73-1.69-.98l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.61.25-1.17.59-1.69.98l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.3.59.22l2.39-.96c.52.4 1.08.73 1.69.98l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.61-.25 1.17-.59 1.69-.98l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 15.6 12 3.6 3.6 0 0 1 12 15.6z"
          />
        </svg>
      </button>

      {open ? (
        <div
          className="master-drawer-backdrop"
          role="presentation"
          onClick={() => setOpen(false)}
        >
          <div
            className="master-drawer-panel"
            role="dialog"
            aria-labelledby="master-drawer-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="master-drawer-head">
              <h2 id="master-drawer-title">Master output</h2>
              <button type="button" className="master-drawer-close" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
            <p className="muted master-drawer-lead">
              Applied to the final RGB for every output mode (loop, interactive, idle) before UDP.
            </p>
            <label className="master-drawer-row">
              <span>Brightness</span>
              <input
                type="range"
                min={0}
                max={200}
                step={1}
                value={Math.round(brightness * 100)}
                disabled={masterToneBusy}
                onChange={(e) => onBrightness(Number(e.target.value) / 100)}
              />
              <span className="master-drawer-value">{(brightness * 100).toFixed(0)}%</span>
            </label>
            <label className="master-drawer-row">
              <span>Gamma</span>
              <input
                type="range"
                min={45}
                max={350}
                step={1}
                value={Math.round(gamma * 100)}
                disabled={masterToneBusy}
                onChange={(e) => onGamma(Number(e.target.value) / 100)}
              />
              <span className="master-drawer-value">{gamma.toFixed(2)}</span>
            </label>
            {masterToneBusy ? <p className="muted">Saving…</p> : null}
          </div>
        </div>
      ) : null}
    </>
  )
}
