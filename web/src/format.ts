export function formatNumber(value: number | null, digits = 1): string {
  return value === null ? '-' : value.toFixed(digits)
}

export function formatUptime(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return h > 0
    ? `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`
    : `${m}m ${s.toString().padStart(2, '0')}s`
}

export function formatDate(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '-'
  return new Date(sec * 1000).toLocaleString()
}
