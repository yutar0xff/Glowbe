import { Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ModeResetBar({
  onReset,
  disabled,
  busy,
}: {
  onReset: () => void | Promise<void>
  disabled?: boolean
  busy?: boolean
}) {
  return (
    <div className="flex justify-end">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        disabled={disabled || busy}
        onClick={() => void onReset()}
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <RotateCcw className="size-3.5" aria-hidden />
        )}
        Reset to defaults
      </Button>
    </div>
  )
}
