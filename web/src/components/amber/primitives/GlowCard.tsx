import { cnm } from '@/utils/style'

interface GlowCardProps {
  children: React.ReactNode
  className?: string
  /** Corner the amber glow bleeds from */
  glowCorner?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  as?: 'div' | 'article'
}

const CORNER_POSITION: Record<
  NonNullable<GlowCardProps['glowCorner']>,
  string
> = {
  'top-left': '-top-24 -left-24',
  'top-right': '-top-24 -right-24',
  'bottom-left': '-bottom-24 -left-24',
  'bottom-right': '-bottom-24 -right-24',
}

/**
 * Rounded ink card with a soft amber glow bleeding from one corner.
 * The single highest-leverage "curvy" move — ref: cetus.zone giant rounded hero.
 */
export default function GlowCard({
  children,
  className,
  glowCorner = 'top-right',
  as = 'div',
}: GlowCardProps) {
  const Comp = as
  return (
    <Comp
      className={cnm(
        'relative overflow-hidden rounded-lg border border-line bg-surface',
        className,
      )}
    >
      <div
        aria-hidden
        className={cnm(
          'pointer-events-none absolute size-72 rounded-full opacity-25 blur-[100px]',
          CORNER_POSITION[glowCorner],
        )}
        style={{
          backgroundImage:
            'radial-gradient(circle, var(--color-primary-bright), var(--color-primary) 60%, transparent 80%)',
        }}
      />
      <div className="relative">{children}</div>
    </Comp>
  )
}
