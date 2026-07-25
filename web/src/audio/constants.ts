import type {
  AudioVisualizerConfig,
  AudioVisualizerPalette,
  AudioVisualizerPattern,
} from './types'

export const DEFAULT_AUDIO_VISUALIZER: AudioVisualizerConfig = {
  pattern: 'radial-spectrum',
  palette: 'rainbow',
  intensity: 1,
  motion: 1,
  persistence: 0.55,
  gamma: 1.75,
  attack: 0.35,
  release: 0.12,
}

export const AUDIO_PATTERNS: { id: AudioVisualizerPattern; label: string; description: string }[] =
  [
    {
      id: 'radial-spectrum',
      label: 'Radial Spectrum',
      description:
        'Frequency bars radiate from the north pole; colors follow the selected palette.',
    },
    {
      id: 'aurora-globe',
      label: 'Aurora Globe',
      description: 'Spiral aurora curtains that breathe with low/mid energy across the sphere.',
    },
    {
      id: 'orbital-spectrum',
      label: 'Orbital Spectrum',
      description: 'Eight great-circle orbits carry grouped frequency energy around the globe.',
    },
    {
      id: 'impact-constellation',
      label: 'Impact Constellation',
      description: 'Onsets spawn shockwaves and sparks that travel across the sphere.',
    },
    {
      id: 'spectrum-bars',
      label: 'Spectrum Bars',
      description: 'Readable longitude bar meter for each frequency band around the equator.',
    },
    {
      id: 'wobbly-ring',
      label: 'Wobbly Ring',
      description: 'A single great-circle ring that gently wobbles with low energy and onsets.',
    },
  ]

export const AUDIO_PALETTES: { id: AudioVisualizerPalette; label: string }[] = [
  { id: 'rainbow', label: 'Rainbow' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'nebula', label: 'Nebula' },
  { id: 'solar', label: 'Solar' },
  { id: 'ice', label: 'Ice' },
]

export const INTENSITY_MIN = 0.25
export const INTENSITY_MAX = 2
export const MOTION_MIN = 0
export const MOTION_MAX = 2
export const PERSISTENCE_MIN = 0
export const PERSISTENCE_MAX = 1
export const GAMMA_MIN = 1
export const GAMMA_MAX = 2.6
export const ATTACK_MIN = 0.01
export const ATTACK_MAX = 1
export const RELEASE_MIN = 0.01
export const RELEASE_MAX = 1
