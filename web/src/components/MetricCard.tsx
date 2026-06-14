import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export function MetricCard({
  label,
  value,
  hint,
  className,
}: {
  label: string
  value: string
  hint?: string
  className?: string
}) {
  return (
    <Card className={cn('shadow-none', className)}>
      <CardHeader className="gap-0.5 pb-2">
        <CardTitle className="font-mono text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 pt-0">
        <p className="font-mono text-sm font-semibold tracking-tight text-foreground">{value}</p>
        {hint ? <p className="font-mono text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}
