export function StatusPill({
  label,
  tone,
}: {
  label: string
  tone: 'ok' | 'warn' | 'bad' | 'muted'
}) {
  return <span className={`pill pill-${tone}`}>{label}</span>
}
