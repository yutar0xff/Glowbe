export type TextModeParams = {
  content: string
  /** Angular glyph height in degrees. */
  textSizeDeg: number
  /** Flow speed in degrees per second (sign selects direction). */
  speedDegPerSec: number
  /** Band center latitude in degrees (0 = equator). */
  centerLatDeg: number
  /** Tilt amount θ in degrees (0 = horizontal, pole at +Y; 90 = vertical). */
  tiltDeg: number
  /** Tilt direction azimuth φ in degrees (from +X, about +Y; 0 = tilt toward the front +X). */
  tiltAzimuthDeg: number
  /** Longitude from the back (deg) below which brightness is 0 (background). */
  fadeStartDeg: number
  /** Longitude from the back (deg) at which brightness reaches full (text color). */
  fadeEndDeg: number
  /** Glyph thickness (ribbon coverage dilation amount, decimals allowed; 0 = plain). */
  thickness: number
  /** Blank interval in seconds inserted after the whole text scrolls off, before it loops. */
  loopIntervalSec: number
  /** Background color as `#rrggbb`. */
  bgColor: string
  /** Text color as `#rrggbb`. */
  textColor: string
}
