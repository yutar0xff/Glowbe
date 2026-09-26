/** Client-side id that works on LAN HTTP (non-secure context), unlike `crypto.randomUUID()`. */
export function newClientId(prefix = 'id'): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // Insecure context (e.g. http://192.168.x.x): randomUUID throws or is unavailable.
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`
}
