import { useState } from 'react'
import { ExternalLink, ImageOff } from 'lucide-react'
import Eyebrow from '@/components/amber/primitives/Eyebrow'
import Button from '@/components/amber/primitives/Button'
import { portraitCardUrl } from '@/lib/portraits-api'

interface ShareCardProps {
  address: string
}

/** Preview of the OG-style share card (`/portrait/:address/card.png`),
 * with a link out to the raw image for saving/sharing. */
export default function ShareCard({ address }: ShareCardProps) {
  const [failed, setFailed] = useState(false)
  const cardUrl = portraitCardUrl(address)

  return (
    <div>
      <Eyebrow>Share card</Eyebrow>
      <p className="display-m mt-3 text-fg">Take it with you.</p>
      <p className="mt-3 max-w-md text-fg-muted leading-[1.6]">
        A ready-made card for this identity — drop it into a profile, a
        deck, or a post.
      </p>

      <div className="mt-8 overflow-hidden rounded-lg border border-line-strong bg-surface shadow-[0_8px_40px_rgba(0,0,0,0.5)]">
        {!failed ? (
          <img
            src={cardUrl}
            alt={`Share card for identity ${address}`}
            loading="lazy"
            crossOrigin="anonymous"
            onError={() => setFailed(true)}
            className="aspect-[1200/630] w-full object-cover"
          />
        ) : (
          <div className="flex aspect-[1200/630] w-full flex-col items-center justify-center gap-2 text-fg-faint">
            <ImageOff className="size-6" aria-hidden="true" />
            <span className="font-mono text-[0.6875rem]">
              card unavailable
            </span>
          </div>
        )}
      </div>

      <Button
        href={cardUrl}
        external
        variant="ghost"
        magnetic={false}
        className="mt-6"
      >
        Open card.png
        <ExternalLink className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  )
}
