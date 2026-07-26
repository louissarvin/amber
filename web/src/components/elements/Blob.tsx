import { cnm } from '@/utils/style'

interface BlobProps {
  className?: string
  /** Blur radius in px */
  blur?: number
  /** Size in px (square) */
  size?: number
  /** 0-1 opacity */
  opacity?: number
  /** Animation delay in seconds, staggers multiple blobs */
  delay?: number
  tone?: 'amber' | 'cognac'
}

const TONES: Record<NonNullable<BlobProps['tone']>, string> = {
  amber:
    'radial-gradient(circle at 35% 30%, var(--color-primary-bright), var(--color-primary) 55%, transparent 75%)',
  cognac:
    'radial-gradient(circle at 60% 40%, var(--color-primary), var(--color-cognac) 60%, transparent 80%)',
}

/**
 * Organic drifting glow blob. Decorative only — aria-hidden, pointer-events-none.
 * Drift freezes automatically under prefers-reduced-motion (see styles.css).
 */
export default function Blob({
  className,
  blur = 100,
  size = 480,
  opacity = 0.16,
  delay = 0,
  tone = 'amber',
}: BlobProps) {
  return (
    <div
      aria-hidden
      className={cnm(
        'animate-blob-drift pointer-events-none absolute',
        className,
      )}
      style={{
        width: size,
        height: size,
        opacity,
        filter: `blur(${blur}px)`,
        backgroundImage: TONES[tone],
        borderRadius: '42% 58% 63% 37% / 45% 38% 62% 55%',
        animationDelay: `${delay}s`,
      }}
    />
  )
}
