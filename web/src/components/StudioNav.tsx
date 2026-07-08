import { Link, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'

const NAV_LINKS = [
  { label: 'Studio', path: '/' },
  { label: 'Clip editor', path: '/clips' },
  { label: 'LED chain profile editor', path: '/chain-profiles' },
] as const

function isActive(path: string, current: string): boolean {
  if (path === '/') return current === '/'
  return current === path || current.startsWith(`${path}/`)
}

export function StudioNav({ compact = false }: { compact?: boolean }) {
  const { pathname } = useLocation()

  return (
    <nav
      className={cn(
        'flex flex-wrap items-center gap-x-1 gap-y-1',
        compact ? 'text-xs' : 'text-sm',
      )}
      aria-label="Studio sections"
    >
      {NAV_LINKS.map((item, i) => (
        <span key={item.path} className="inline-flex items-center gap-1">
          {i > 0 ? (
            <span className="text-muted-foreground/50" aria-hidden>
              /
            </span>
          ) : null}
          <Link
            to={item.path}
            className={cn(
              'rounded-md px-2 py-1 font-medium transition-colors',
              isActive(item.path, pathname)
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            {item.label}
          </Link>
        </span>
      ))}
    </nav>
  )
}
