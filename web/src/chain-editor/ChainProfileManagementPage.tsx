import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Copy, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  deleteChainProfile,
  duplicateChainProfile,
  fetchLayoutCatalog,
} from '@/chain-editor/layout-save'
import type { CompiledLayoutSummary } from '@/types'
import { Button } from '@/components/ui/button'

function profileLabel(row: CompiledLayoutSummary) {
  const name = row.displayName?.trim() || row.layoutId
  const gpio = row.gpios?.length ?? row.dataLineCount
  const gpioHint = gpio != null ? `${gpio} line${gpio === 1 ? '' : 's'}` : null
  const ledHint = `${row.ledCount} LED${row.ledCount === 1 ? '' : 's'}`
  return gpioHint ? `${name} · ${ledHint} · ${gpioHint}` : `${name} · ${ledHint}`
}

import {
  canDeleteChainProfile,
  canEditChainProfile,
  isUserChainProfile,
} from '@/chain-editor/chain-profile-utils'

export function ChainProfileManagementPage() {
  const [search] = useSearchParams()
  const returnTo = search.get('returnTo')
  const returnQuery = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''

  const backHref = useMemo(() => {
    if (returnTo === 'device') return '/?panel=device'
    return '/'
  }, [returnTo])

  const [catalog, setCatalog] = useState<CompiledLayoutSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      setCatalog(await fetchLayoutCatalog())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const onDuplicate = async (row: CompiledLayoutSummary) => {
    setBusyId(row.layoutId)
    setError(null)
    try {
      const saved = await duplicateChainProfile(row.layoutId)
      await refresh()
      window.location.assign(
        `/chain-profiles/${encodeURIComponent(saved.layoutId)}/edit${returnQuery}`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  const onDelete = async (row: CompiledLayoutSummary) => {
    if (!canDeleteChainProfile(row)) return
    const name = row.displayName?.trim() || row.layoutId
    if (!window.confirm(`Delete chain profile "${name}"? This cannot be undone.`)) return
    setBusyId(row.layoutId)
    setError(null)
    try {
      await deleteChainProfile(row.layoutId)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  const presets = catalog.filter((r) => !isUserChainProfile(r))
  const custom = catalog.filter((r) => isUserChainProfile(r))

  return (
    <div className="mx-auto flex min-h-svh max-w-3xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="ghost" size="sm" asChild>
          <Link to={backHref}>
            <ArrowLeft className="size-4" aria-hidden />
            Back
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">Chain profile management</h1>
          <p className="text-sm text-muted-foreground">
            Create, edit, duplicate, and delete LED chain profiles.
          </p>
        </div>
        <Button type="button" size="sm" asChild>
          <Link to={`/chain-profiles/new/edit${returnQuery}`}>
            <Plus className="size-4" aria-hidden />
            New profile
          </Link>
        </Button>
      </header>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading profiles…
        </div>
      ) : (
        <div className="space-y-6">
          {(
            [
              { title: 'Presets', rows: presets },
              { title: 'Custom', rows: custom },
            ] as const
          ).map(({ title, rows }) =>
            rows.length === 0 ? null : (
              <section key={title} className="space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {title}
                </h2>
                <ul className="divide-y rounded-lg border border-border/80 bg-card/40">
                  {rows.map((row) => {
                    const busy = busyId === row.layoutId
                    const deletable = canDeleteChainProfile(row)
                    const editable = canEditChainProfile(row)
                    return (
                      <li
                        key={row.layoutId}
                        className="flex flex-wrap items-center gap-2 px-3 py-3 sm:gap-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{profileLabel(row)}</p>
                          <p className="truncate font-mono text-[10px] text-muted-foreground">
                            {row.layoutId}
                            {row.inUseByDevices?.length
                              ? ` · in use by ${row.inUseByDevices.length} device${row.inUseByDevices.length === 1 ? '' : 's'}`
                              : ''}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-1">
                          {editable ? (
                            <Button type="button" variant="outline" size="sm" asChild>
                              <Link
                                to={`/chain-profiles/${encodeURIComponent(row.layoutId)}/edit${returnQuery}`}
                              >
                                <Pencil className="size-3.5" aria-hidden />
                                Edit
                              </Link>
                            </Button>
                          ) : (
                            <Button type="button" variant="outline" size="sm" disabled>
                              <Pencil className="size-3.5" aria-hidden />
                              Edit
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => void onDuplicate(row)}
                          >
                            {busy ? (
                              <Loader2 className="size-3.5 animate-spin" aria-hidden />
                            ) : (
                              <Copy className="size-3.5" aria-hidden />
                            )}
                            Duplicate
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy || !deletable}
                            onClick={() => void onDelete(row)}
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                            Delete
                          </Button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ),
          )}
          {catalog.length === 0 ? (
            <p className="text-sm text-muted-foreground">No chain profiles found.</p>
          ) : null}
        </div>
      )}
    </div>
  )
}
