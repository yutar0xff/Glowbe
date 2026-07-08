/** Web 上タップハイライトのフェード時間（ms）。 */
export const TAP_HIGHLIGHT_DECAY_MS = 1400

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

/**
 * ランタイム `sphere::unit_dir_from_equirect_uv_y_up` と同じ式。
 * Y 上、**v=0 が北極 (+Y)**、**v=1 が南極 (−Y)**、u は経度（周期）。
 * 2D equirect マップでも v=0 が画像上端。
 */
export function uvToUnitDirYUp(u: number, v: number): [number, number, number] {
  const uu = ((u % 1) + 1) % 1
  const vv = Math.min(1, Math.max(0, v))
  const lam = 2 * Math.PI * uu - Math.PI
  const phi = 0.5 * Math.PI - Math.PI * vv
  const cp = Math.cos(phi)
  const x = cp * Math.cos(lam)
  const y = Math.sin(phi)
  const z = cp * Math.sin(lam)
  return [x, y, z]
}

/**
 * Device / ledmap equirect `u` → longitude parameter for {@link uvToUnitDirYUp} on the 3D sphere (inverse of
 * {@link sphereHitUvToDeviceEquirectUv} on `u`).
 */
export function deviceEquirectUToSphereU(u: number): number {
  const uu = ((u % 1) + 1) % 1
  return 1 - uu
}

/**
 * 球面レイの u を {@link equirectDisplayPointerToUv} と同じデバイス用 u に合わせる（v はそのまま）。
 */
export function sphereHitUvToDeviceEquirectUv(u: number, v: number): { u: number; v: number } {
  const uu = ((u % 1) + 1) % 1
  const vv = Math.min(1, Math.max(0, v))
  const uDevice = Math.min(1, Math.max(0, 1 - uu))
  return { u: uDevice, v: vv }
}

/** 単位方向（Y 上）→ 正距円筒 UV。球面タップのヒット法線から (u,v) を求める。 */
export function unitDirYUpToUv(x: number, y: number, z: number): { u: number; v: number } {
  const len = Math.hypot(x, y, z) || 1
  const nx = x / len
  const ny = y / len
  const nz = z / len
  const phi = Math.asin(Math.max(-1, Math.min(1, ny)))
  const v = 0.5 - phi / Math.PI
  if (Math.abs(ny) > 0.999) {
    return { u: 0, v: ny > 0 ? 0 : 1 }
  }
  const lam = Math.atan2(nz, nx)
  let u = (lam + Math.PI) / (2 * Math.PI)
  u = ((u % 1) + 1) % 1
  return { u, v: Math.min(1, Math.max(0, v)) }
}
