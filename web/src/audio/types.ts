export type AudioInputKind = 'source' | 'monitor'

export type AudioVisualizerPattern =
  | 'radial-spectrum'
  | 'aurora-globe'
  | 'orbital-spectrum'
  | 'impact-constellation'
  | 'spectrum-bars'
  | 'wobbly-ring'

export type AudioVisualizerPalette = 'rainbow' | 'aurora' | 'nebula' | 'solar' | 'ice'

export type AudioPlatformInfo = {
  available: boolean
  reason?: string | null
  backend: string
}

export type AudioInputDevice = {
  id: string
  name: string
  kind: AudioInputKind
}

export type AudioInputsResponse = {
  platform: AudioPlatformInfo
  inputs: AudioInputDevice[]
  selectedInputId?: string | null
}

export type AudioVisualizerSnapshot = {
  connected: boolean
  inputId?: string | null
  inputName?: string | null
  inputKind?: AudioInputKind | null
  rms: number
  peak: number
  bass: number
  beat: boolean
  low: number
  mid: number
  high: number
  centroid: number
  flux: number
  onset: number
  bands: number[]
  pattern: AudioVisualizerPattern | string
  palette: AudioVisualizerPalette | string
  intensity: number
  motion: number
  persistence: number
  gamma: number
  attack: number
  release: number
  error?: string | null
}

export type AudioVisualizerConfig = {
  pattern: AudioVisualizerPattern
  palette: AudioVisualizerPalette
  intensity: number
  motion: number
  persistence: number
  gamma: number
  attack: number
  release: number
}
