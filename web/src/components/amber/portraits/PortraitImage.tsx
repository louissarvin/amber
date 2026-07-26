import { useState } from 'react'
import { ImageOff } from 'lucide-react'
import { portraitSvgUrl } from '@/lib/portraits-api'
import { cnm } from '@/utils/style'

interface PortraitImageProps {
  /** Full or truncated leaderboard identity — used to build the src. */
  identity: string
  alt: string
  className?: string
}

/**
 * Loads the generative constellation SVG via a plain `<img>` (never
 * dangerouslySetInnerHTML — the SVG is untrusted third-party content).
 * Truncated identities and empty portraits both 400/404 server-side;
 * either way this resolves to a calm placeholder, never a broken image.
 */
export default function PortraitImage({
  identity,
  alt,
  className,
}: PortraitImageProps) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <div
        className={cnm(
          'flex size-full flex-col items-center justify-center gap-2 text-fg-faint',
          className,
        )}
      >
        <ImageOff className="size-6" aria-hidden="true" />
        <span className="font-mono text-[0.6875rem]">no portrait yet</span>
      </div>
    )
  }

  return (
    <img
      src={portraitSvgUrl(identity)}
      alt={alt}
      loading="lazy"
      crossOrigin="anonymous"
      onError={() => setFailed(true)}
      className={cnm('size-full object-contain', className)}
    />
  )
}
