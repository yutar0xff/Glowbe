/** 画面上の 2:1 equirect サムネイル（SVG viewBox 0 0 2 1 と同じ見た目）でのクリック → API 用 (u,v) ∈ [0,1]² */
export function equirectDisplayPointerToUv(
  clientX: number,
  clientY: number,
  rect: DOMRect,
): { u: number; v: number } {
  const u = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  const v = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height))
  return { u, v }
}
