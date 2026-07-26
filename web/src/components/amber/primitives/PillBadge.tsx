import { cnm } from '@/utils/style'

interface PillBadgeProps {
  children: React.ReactNode
  className?: string
  dot?: boolean
}

export default function PillBadge({
  children,
  className,
  dot = false,
}: PillBadgeProps) {
  return (
    <span
      className={cnm(
        'inline-flex items-center gap-2 rounded-pill border border-line-strong bg-surface/60',
        'px-4 py-1.5 font-mono text-[0.6875rem] tracking-[0.02em] text-fg-muted',
        'backdrop-blur-sm',
        className,
      )}
    >
      {dot && (
        <span className="relative flex size-1.5" aria-hidden="true">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
        </span>
      )}
      {children}
    </span>
  )
}
