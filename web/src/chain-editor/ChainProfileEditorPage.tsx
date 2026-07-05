import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { API_BASE } from '@/api'
import { Button } from '@/components/ui/button'
import { ChainProfileEditorProvider } from '@/chain-editor/chain-profile-editor-context'
import { DeviceSetupFlow } from '@/chain-editor/device-setup-flow'
import {
  canDeleteChainProfile,
  isProfileEditorLocked,
  isUserChainProfile,
} from '@/chain-editor/chain-profile-utils'
import {
  editorStateToGlowbeLayout,
  glowbeLayoutToEditorPatch,
  type GlowbeLayout,
} from '@/chain-editor/glowbe-layout-io'
import {
  createChainProfile,
  deleteChainProfile,
  duplicateChainProfile,
  fetchLayoutCatalog,
  newCustomLayoutId,
  updateChainProfile,
  type SaveLayoutResponse,
} from '@/chain-editor/layout-save'
import { useEditorStore } from '@/chain-editor/stores/editor-store'
import { resolveRigSafe } from '@/chain-editor/stores/editor-wiring-rig'
import type { CompiledLayoutSummary } from '@/types'
import { DEFAULT_LAYOUT_ID } from '@/layout-ids'
const DRAFT_ROUTE_ID = 'new'

type PromotedLocationState = {
  promoted?: boolean
  saveNotice?: SaveLayoutResponse
  displayName?: string
}

export function ChainProfileEditorPage() {
  const { id: routeId } = useParams<{ id: string }>()
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()

  const isDraftRoute = routeId === DRAFT_ROUTE_ID

  const [layoutId, setLayoutId] = useState<string | null>(
    isDraftRoute ? null : (routeId ?? null),
  )
  const [displayName, setDisplayName] = useState('')
  const [variant, setVariant] = useState('custom')
  const [layoutHash, setLayoutHash] = useState<number | null>(null)
  const [ledCount, setLedCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saveBusy, setSaveBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveNotice, setSaveNotice] = useState<SaveLayoutResponse | null>(null)
  const [catalog, setCatalog] = useState<CompiledLayoutSummary[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState(
    isDraftRoute ? DEFAULT_LAYOUT_ID : (routeId ?? DEFAULT_LAYOUT_ID),
  )
  const [profileActionBusy, setProfileActionBusy] = useState(false)
  const [profileActionError, setProfileActionError] = useState<string | null>(null)

  const returnTo = search.get('returnTo')
  const returnQuery = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''

  const layoutRevision = useEditorStore((s) => s.layoutRevision)
  const storeError = useEditorStore((s) => s.error)
  const savedSnapshotRef = useRef<{ layoutRevision: number; displayName: string } | null>(null)
  const promotedRouteRef = useRef<string | null>(null)

  const backHref = useMemo(() => {
    if (returnTo === 'device') return '/?panel=device'
    return '/'
  }, [returnTo])

  const applyLayoutToEditor = useCallback(
    (layout: GlowbeLayout, opts: { persistId: boolean; defaultDisplayName?: string }) => {
      const patch = glowbeLayoutToEditorPatch(layout)
      useEditorStore.setState((s) => ({
        ...s,
        ...patch,
        layoutRevision: s.layoutRevision + 1,
      }))
      const { leds, error: resolveErr } = resolveRigSafe(patch.rig!)
      useEditorStore.setState({ leds, error: resolveErr })
      if (opts.persistId) {
        setLayoutId(layout.id)
        setDisplayName(layout.displayName)
      } else {
        setLayoutId(null)
        setDisplayName(opts.defaultDisplayName ?? 'New chain profile')
      }
      setVariant(layout.variant || 'custom')
    },
    [],
  )

  const refreshCatalog = useCallback(async () => {
    const rows = await fetchLayoutCatalog()
    setCatalog(rows)
    return rows
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const rows = await fetchLayoutCatalog()
        if (!cancelled) setCatalog(rows)
      } catch {
        /* optional */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const promoted = location.state as PromotedLocationState | null
    if (promoted?.promoted && promoted.saveNotice && routeId && !isDraftRoute) {
      promotedRouteRef.current = routeId
      setLayoutId(routeId)
      setDisplayName(promoted.displayName ?? promoted.saveNotice.layoutId)
      setLayoutHash(promoted.saveNotice.layoutHash)
      setLedCount(promoted.saveNotice.ledCount)
      setSaveNotice(promoted.saveNotice)
      savedSnapshotRef.current = {
        layoutRevision: useEditorStore.getState().layoutRevision,
        displayName: promoted.displayName ?? promoted.saveNotice.layoutId,
      }
      setLoading(false)
      setError(null)
      navigate(location.pathname + location.search, { replace: true, state: null })
      return
    }

    if (promotedRouteRef.current === routeId) {
      setLoading(false)
      return
    }

    if (isDraftRoute) return

    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        if (!routeId) throw new Error('Missing profile id')
        const res = await fetch(`${API_BASE}/api/v1/layouts/${encodeURIComponent(routeId)}/source`)
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `HTTP ${res.status}`)
        }
        const layout = (await res.json()) as GlowbeLayout
        if (cancelled) return
        applyLayoutToEditor(layout, { persistId: true })
        setSelectedProfileId(routeId)

        const rows = await refreshCatalog()
        const row = rows.find((r) => r.layoutId === routeId)
        if (row) {
          setLayoutHash(row.layoutHash ?? null)
          setLedCount(row.ledCount ?? null)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isDraftRoute, routeId, applyLayoutToEditor, location.state, location.pathname, location.search, navigate, refreshCatalog])

  useEffect(() => {
    if (!isDraftRoute) return

    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const presetId = selectedProfileId || DEFAULT_LAYOUT_ID
        const res = await fetch(`${API_BASE}/api/v1/layouts/${encodeURIComponent(presetId)}/source`)
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `HTTP ${res.status}`)
        }
        const layout = (await res.json()) as GlowbeLayout
        if (cancelled) return
        applyLayoutToEditor(layout, { persistId: false, defaultDisplayName: 'New chain profile' })
        setLayoutHash(null)
        setLedCount(null)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isDraftRoute, selectedProfileId, applyLayoutToEditor])

  useEffect(() => {
    if (!saveNotice || !savedSnapshotRef.current) return
    const snap = savedSnapshotRef.current
    if (layoutRevision !== snap.layoutRevision || displayName !== snap.displayName) {
      setSaveNotice(null)
      savedSnapshotRef.current = null
    }
  }, [layoutRevision, displayName, saveNotice])

  const effectiveProfileId = isDraftRoute ? selectedProfileId : (layoutId ?? selectedProfileId)
  const selectedRow = catalog.find((r) => r.layoutId === effectiveProfileId)
  const isPresetLocked = isProfileEditorLocked(selectedRow, {
    isDraft: isDraftRoute,
    layoutId,
  })
  const canSave = !isPresetLocked && (isDraftRoute || layoutId != null)

  const onSave = useCallback(async () => {
    if (!canSave) return
    setSaveBusy(true)
    setError(null)
    setSaveNotice(null)
    try {
      const state = useEditorStore.getState()
      const layout = editorStateToGlowbeLayout(state, { variant })
      layout.displayName = displayName.trim() || layout.id

      if (isDraftRoute || !layoutId) {
        const id = newCustomLayoutId()
        layout.id = id
        layout.variant = 'custom'
        useEditorStore.setState((s) => ({
          rig: {
            ...s.rig,
            meta: { ...s.rig.meta, id, name: layout.displayName },
          },
        }))
        const saved = await createChainProfile(layout)
        savedSnapshotRef.current = {
          layoutRevision: useEditorStore.getState().layoutRevision,
          displayName: layout.displayName,
        }
        navigate(`/chain-profiles/${encodeURIComponent(saved.layoutId)}/edit${returnQuery}`, {
          replace: true,
          state: {
            promoted: true,
            saveNotice: saved,
            displayName: layout.displayName,
          },
        })
        return
      }

      layout.id = layoutId
      useEditorStore.setState((s) => ({
        rig: {
          ...s.rig,
          meta: { ...s.rig.meta, id: layoutId, name: layout.displayName },
        },
      }))
      const saved = await updateChainProfile(layoutId, layout)
      setLayoutHash(saved.layoutHash)
      setLedCount(saved.ledCount)
      savedSnapshotRef.current = {
        layoutRevision: useEditorStore.getState().layoutRevision,
        displayName: layout.displayName,
      }
      setSaveNotice(saved)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaveBusy(false)
    }
  }, [
    canSave,
    variant,
    displayName,
    isDraftRoute,
    layoutId,
    navigate,
    returnQuery,
  ])

  const onSelectProfile = useCallback(
    (id: string) => {
      setProfileActionError(null)
      if (isDraftRoute) {
        const row = catalog.find((r) => r.layoutId === id)
        if (row && isUserChainProfile(row)) {
          navigate(`/chain-profiles/${encodeURIComponent(id)}/edit${returnQuery}`)
          return
        }
        setSelectedProfileId(id)
        return
      }
      if (id !== layoutId) {
        navigate(`/chain-profiles/${encodeURIComponent(id)}/edit${returnQuery}`)
      }
    },
    [isDraftRoute, catalog, navigate, returnQuery, layoutId],
  )

  const onEditProfile = useCallback(
    (id: string) => {
      setProfileActionError(null)
      navigate(`/chain-profiles/${encodeURIComponent(id)}/edit${returnQuery}`)
    },
    [navigate, returnQuery],
  )

  const onDuplicateProfile = useCallback(
    async (id: string) => {
      setProfileActionBusy(true)
      setProfileActionError(null)
      try {
        const saved = await duplicateChainProfile(id)
        await refreshCatalog()
        navigate(`/chain-profiles/${encodeURIComponent(saved.layoutId)}/edit${returnQuery}`, {
          replace: false,
          state: {
            promoted: true,
            saveNotice: saved,
            displayName: saved.layoutId,
          },
        })
      } catch (e) {
        setProfileActionError(e instanceof Error ? e.message : String(e))
      } finally {
        setProfileActionBusy(false)
      }
    },
    [navigate, returnQuery, refreshCatalog],
  )

  const onDeleteProfile = useCallback(
    async (id: string) => {
      const row = catalog.find((r) => r.layoutId === id)
      if (!row || !canDeleteChainProfile(row)) return
      const name = row.displayName?.trim() || id
      if (!window.confirm(`Delete chain profile "${name}"? This cannot be undone.`)) return
      setProfileActionBusy(true)
      setProfileActionError(null)
      try {
        await deleteChainProfile(id)
        const rows = await refreshCatalog()
        if (layoutId === id || (isDraftRoute && selectedProfileId === id)) {
          const fallback =
            rows.find((r) => !isUserChainProfile(r))?.layoutId ?? DEFAULT_LAYOUT_ID
          if (isDraftRoute) {
            setSelectedProfileId(fallback)
          } else {
            navigate(`/chain-profiles/${encodeURIComponent(fallback)}/edit${returnQuery}`, {
              replace: true,
            })
          }
        }
      } catch (e) {
        setProfileActionError(e instanceof Error ? e.message : String(e))
      } finally {
        setProfileActionBusy(false)
      }
    },
    [
      catalog,
      layoutId,
      isDraftRoute,
      selectedProfileId,
      refreshCatalog,
      navigate,
      returnQuery,
    ],
  )

  const editorContext = useMemo(
    () => ({
      isDraft: isDraftRoute,
      layoutId,
      selectedProfileId: effectiveProfileId,
      catalog,
      profileActionBusy,
      profileActionError,
      isPresetLocked,
      canSave,
      displayName,
      setDisplayName,
      saveBusy,
      onSave,
      saveNotice,
      layoutHash,
      ledCount,
      returnTo,
      backHref,
      onSelectProfile,
      onEditProfile,
      onDuplicateProfile,
      onDeleteProfile,
    }),
    [
      isDraftRoute,
      layoutId,
      effectiveProfileId,
      catalog,
      profileActionBusy,
      profileActionError,
      isPresetLocked,
      canSave,
      displayName,
      saveBusy,
      onSave,
      saveNotice,
      layoutHash,
      ledCount,
      returnTo,
      backHref,
      onSelectProfile,
      onEditProfile,
      onDuplicateProfile,
      onDeleteProfile,
    ],
  )

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Loading chain profile…
      </div>
    )
  }

  return (
    <ChainProfileEditorProvider value={editorContext}>
      <div className="flex h-svh min-h-0 flex-col bg-background">
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b px-3 py-2 sm:px-4">
          <Button type="button" variant="ghost" size="sm" asChild>
            <Link to={backHref}>
              <ArrowLeft className="size-4" aria-hidden />
              Back
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">
              {isDraftRoute ? 'New chain profile' : 'Chain profile editor'}
            </h1>
            {layoutId ? (
              <p className="truncate font-mono text-xs text-muted-foreground">{layoutId}</p>
            ) : (
              <p className="truncate text-xs text-muted-foreground">Unsaved draft</p>
            )}
          </div>
        </header>

        {(error || storeError) && (
          <div className="shrink-0 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error ?? storeError}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden">
          <DeviceSetupFlow />
        </div>
      </div>
    </ChainProfileEditorProvider>
  )
}
