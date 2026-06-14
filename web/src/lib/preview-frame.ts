/** Binary LED preview WebSocket header (same magic as runtime, big-endian). */
export const PREVIEW_FRAME_MAGIC = 0x4742_5031

export type ParsedPreviewFrame = {
  seq: number
  rgb: Uint8Array
}

export function parsePreviewRgbFrame(buf: ArrayBuffer): ParsedPreviewFrame | null {
  if (buf.byteLength < 12) return null
  const dv = new DataView(buf)
  if (dv.getUint32(0, false) !== PREVIEW_FRAME_MAGIC) return null
  const seq = dv.getUint32(4, false)
  const ledCount = dv.getUint16(8, false)
  const rgbLen = ledCount * 3
  if (12 + rgbLen !== buf.byteLength) return null
  return { seq, rgb: new Uint8Array(buf, 12, rgbLen) }
}
