import { AlertTriangle, CheckCircle2, CircleSlash, Gauge } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const toneIcon = {
  ok: CheckCircle2,
  warn: AlertTriangle,
  bad: AlertTriangle,
  muted: CircleSlash,
  fps: Gauge,
} as const

export function StatusPill({
  label,
  tone,
}: {
  label: string
  tone: 'ok' | 'warn' | 'bad' | 'muted' | 'fps'
}) {
  const Icon = toneIcon[tone]
  return (
    <Badge
      variant={tone === 'bad' ? 'destructive' : tone === 'warn' ? 'outline' : 'secondary'}
      className={cn(
        'gap-1.5 px-2.5 py-1 font-mono text-xs font-semibold',
        tone === 'warn' && 'border-amber-500/50 text-amber-300',
        tone === 'ok' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
        tone === 'fps' && 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200',
        tone === 'muted' && 'text-muted-foreground',
      )}
    >
      <Icon className="size-3.5 shrink-0 opacity-90" aria-hidden />
      {label}
    </Badge>
  )
}
