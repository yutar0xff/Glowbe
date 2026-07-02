export type MatePresetSummary = {
  id: string
  displayName: string
  partCount: number
  source: string
  breathingPeriodMs: number
}

export type MateBreathingParams = {
  enabled: boolean
}

export type MatePresetsResponse = {
  presets: MatePresetSummary[]
  matePresetId?: string | null
  mateBreathing: MateBreathingParams
}
