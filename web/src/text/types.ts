export type TextModeParams = {
  content: string
  /** Angular glyph height in degrees. */
  textSizeDeg: number
  /** Flow speed in degrees per second (sign selects direction). */
  speedDegPerSec: number
  /** Band mid-front RH yaw about +Y (deg). 0 = +X front. */
  yawDeg: number
  /** Band mid-front elevation toward +Y (deg). */
  pitchDeg: number
  /** Twist about band-center outward axis (deg, RH). */
  rollDeg: number
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
