import type { TextModeParams } from './types'

export const TEXT_SIZE_DEG_MIN = 10
export const TEXT_SIZE_DEG_MAX = 180
export const SPEED_DEG_PER_SEC_MIN = -360
export const SPEED_DEG_PER_SEC_MAX = 360
export const CENTER_LAT_DEG_MIN = -80
export const CENTER_LAT_DEG_MAX = 80
export const TILT_DEG_MIN = -90
export const TILT_DEG_MAX = 90
export const FADE_ANGLE_DEG_MIN = 0
export const FADE_ANGLE_DEG_MAX = 180
export const THICKNESS_MIN = 0
export const THICKNESS_MAX = 6
export const LOOP_INTERVAL_SEC_MIN = 0
export const LOOP_INTERVAL_SEC_MAX = 30
export const TEXT_CONTENT_MAX = 256

export const DEFAULT_TEXT_PARAMS: TextModeParams = {
  content: 'This is Glowbe.',
  textSizeDeg: 140,
  speedDegPerSec: 80,
  centerLatDeg: 15,
  tiltDeg: 0,
  fadeStartDeg: 0,
  fadeEndDeg: 120,
  thickness: 1,
  loopIntervalSec: 2,
  bgColor: '#000000',
  textColor: '#3b82f6',
}
