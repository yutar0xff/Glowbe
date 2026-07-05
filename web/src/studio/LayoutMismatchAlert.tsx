import { AlertTriangle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { formatLayoutHash } from '@/layout-ids'

export function LayoutMismatchAlert({
  layoutId,
  expectedLayoutHash,
  espLayoutHash,
  compact = false,
}: {
  layoutId: string
  expectedLayoutHash?: number | null
  espLayoutHash?: number | null
  compact?: boolean
}) {
  return (
    <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-100">
      <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" aria-hidden />
      <AlertTitle>Firmware layout mismatch</AlertTitle>
      <AlertDescription className="space-y-2 text-amber-950/90 dark:text-amber-100/90">
        <p>
          The ESP reports a different <code className="font-mono text-xs">layout_hash</code> than the compiled profile{' '}
          <code className="font-mono text-xs">{layoutId}</code> selected for this device.
        </p>
        <p className="font-mono text-xs">
          Expected {formatLayoutHash(expectedLayoutHash)} · ESP {formatLayoutHash(espLayoutHash)}
        </p>
        {!compact ? (
          <>
            <p className="text-xs">
              Rebuild and flash firmware with the generated header for this profile, then confirm the hashes match.
            </p>
            <pre className="overflow-x-auto rounded bg-black/10 p-2 font-mono text-[10px]">
              cd firmware/esp32{'\n'}uv run pio run -e 60panels -t upload
            </pre>
          </>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}
