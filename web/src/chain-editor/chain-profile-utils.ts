import type { CompiledLayoutSummary } from '@/types'

/** True for user-created chain profiles (editable), including in-use profiles. */
export function isUserChainProfile(row: CompiledLayoutSummary | null | undefined): boolean {
  if (!row) return false
  if (row.sourceKind === 'user') return true
  if (row.sourceKind === 'preset') return false
  if (row.variant === 'custom') return true
  if (row.layoutId.startsWith('custom-')) return true
  return row.editable === true
}

export function isPresetChainProfile(row: CompiledLayoutSummary | null | undefined): boolean {
  if (!row) return false
  return !isUserChainProfile(row)
}

export function canEditChainProfile(row: CompiledLayoutSummary | null | undefined): boolean {
  return isUserChainProfile(row)
}

export function canDeleteChainProfile(row: CompiledLayoutSummary | null | undefined): boolean {
  if (!row) return false
  return isUserChainProfile(row) && !(row.inUseByDevices?.length)
}

/** When catalog row is missing, infer from route id (non-draft custom edit pages). */
export function layoutIdLooksCustom(layoutId: string | null | undefined): boolean {
  return Boolean(layoutId?.startsWith('custom-'))
}

export function isProfileEditorLocked(
  row: CompiledLayoutSummary | null | undefined,
  opts: { isDraft: boolean; layoutId: string | null },
): boolean {
  if (row) return isPresetChainProfile(row)
  if (opts.isDraft) return true
  if (layoutIdLooksCustom(opts.layoutId)) return false
  return false
}
