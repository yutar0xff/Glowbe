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
  compact = false,
  showIcon = true,
}: {
  label: string
  tone: 'ok' | 'warn' | 'bad' | 'muted' | 'fps'
  compact?: boolean
  showIcon?: boolean
}) {
  const Icon = toneIcon[tone]
  return (
    <Badge
      variant={tone === 'bad' ? 'destructive' : tone === 'warn' ? 'outline' : 'secondary'}
      className={cn(
        'gap-1.5 px-2.5 py-1 font-mono text-xs font-semibold whitespace-nowrap',
        compact && 'gap-1 px-2 py-0.5 text-[11px] leading-none',
        tone === 'warn' && 'border-amber-500/50 bg-amber-500/10 text-amber-300',
        tone === 'ok' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
        tone === 'fps' && 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200',
        tone === 'muted' && 'text-muted-foreground',
      )}
    >
      {showIcon ? (
        <Icon className={cn('shrink-0 opacity-90', compact ? 'size-3' : 'size-3.5')} aria-hidden />
      ) : null}
      {label}
    </Badge>
  )
}
