import { createContext, useContext, type ReactNode } from 'react'
import type { SaveLayoutResponse } from '@/chain-editor/layout-save'
import type { CompiledLayoutSummary } from '@/types'

export type ChainProfileEditorContextValue = {
  isDraft: boolean
  layoutId: string | null
  selectedProfileId: string
  catalog: CompiledLayoutSummary[]
  profileActionBusy: boolean
  profileActionError: string | null
  isPresetLocked: boolean
  canSave: boolean
  displayName: string
  setDisplayName: (name: string) => void
  saveBusy: boolean
  onSave: () => void | Promise<void>
  saveNotice: SaveLayoutResponse | null
  layoutHash: number | null
  ledCount: number | null
  returnTo: string | null
  backHref: string
  onSelectProfile: (layoutId: string) => void
  onEditProfile: (layoutId: string) => void
  onDuplicateProfile: (layoutId: string) => void
  onDeleteProfile: (layoutId: string) => void
}

const ChainProfileEditorContext = createContext<ChainProfileEditorContextValue | null>(null)

export function ChainProfileEditorProvider({
  value,
  children,
}: {
  value: ChainProfileEditorContextValue
  children: ReactNode
}) {
  return <ChainProfileEditorContext.Provider value={value}>{children}</ChainProfileEditorContext.Provider>
}

export function useChainProfileEditor() {
  return useContext(ChainProfileEditorContext)
}

export function useEditorReadOnly() {
  return useChainProfileEditor()?.isPresetLocked ?? false
}
