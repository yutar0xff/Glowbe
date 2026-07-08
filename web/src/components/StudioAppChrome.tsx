import { useEffect, useRef, useState, type ReactNode } from 'react'
import { StudioNav } from '@/components/StudioNav'
import { STUDIO_PAGE_CLASS } from '@/lib/studio-shell'
import { cn } from '@/lib/utils'

/**
 * Shared Studio page shell: sticky top bar + hero “Glowbe Studio” title/nav.
 * Keeps title position stable across Studio home, Clip editor, etc.
 */
export function StudioAppChrome({
  eyebrow,
  description,
  trailing,
  stickyTrailing,
  children,
}: {
  eyebrow: string
  description?: ReactNode
  /** Right side of the in-flow header (e.g. status pills). */
  trailing?: ReactNode
  /** Right side of the sticky bar (compact status pills). */
  stickyTrailing?: ReactNode
  children: ReactNode
}) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [stuck, setStuck] = useState(false)

  useEffect(() => {
    const el = titleRef.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), {
      threshold: 0,
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <main className={STUDIO_PAGE_CLASS}>
      <div
        className={cn(
          'fixed inset-x-0 top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md transition-[transform,opacity] duration-300 ease-out',
          stuck ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-full opacity-0',
        )}
        aria-hidden={!stuck}
      >
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-4 md:px-6">
          <span
            className={cn(
              'shrink-0 font-heading text-lg font-extrabold tracking-tight whitespace-nowrap transition-all duration-300 ease-out',
              stuck ? 'translate-y-0 opacity-100' : 'translate-y-1.5 opacity-0',
            )}
          >
            Glowbe Studio
          </span>
          <StudioNav compact />
          <div className="flex min-w-0 flex-nowrap items-center justify-end gap-2 overflow-hidden">
            {stickyTrailing ?? null}
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-5xl px-4 pt-10 md:px-6 md:pt-14">
        <header className="mb-10 flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <p className="font-mono text-xs font-bold tracking-[0.2em] text-cyan-400 uppercase">
              {eyebrow}
            </p>
            <h1 ref={titleRef} className="font-heading text-4xl font-extrabold tracking-tight md:text-5xl">
              Glowbe Studio
            </h1>
            <StudioNav />
            {description ? (
              <p className="max-w-xl text-sm text-muted-foreground md:text-base">{description}</p>
            ) : null}
          </div>
          {trailing ? (
            <div className="flex flex-wrap items-center justify-end gap-3">{trailing}</div>
          ) : null}
        </header>
        {children}
      </div>
    </main>
  )
}
