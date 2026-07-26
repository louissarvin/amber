import Section from '@/components/elements/Section'
import Blob from '@/components/elements/Blob'
import Button from '@/components/amber/primitives/Button'
import { config } from '@/config'

/**
 * Landing-only CTA well (big wordmark + tagline + CTAs). The global
 * footer bar lives in `@/components/amber/Footer.tsx` and is rendered
 * once from the root layout, directly beneath this section.
 */
export default function FooterCTA() {
  return (
    <Section room className="relative overflow-hidden text-center">
      <Blob
        tone="amber"
        size={520}
        opacity={0.14}
        className="top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
      />

      <div className="relative">
        <img
          src="/assets/logo.svg"
          alt="AMBER"
          width={512}
          height={288}
          className="mx-auto h-28 w-auto md:h-36"
        />
        <p className="mt-6 text-lg text-fg-secondary">{config.tagline}</p>

        <div className="mt-10 flex flex-wrap justify-center gap-4">
          <Button href={config.links.marketplace} variant="primary">
            Explore on OKX.AI
          </Button>
          <Button href={config.links.twitter} variant="ghost">
            #OKXAI
          </Button>
        </div>
      </div>
    </Section>
  )
}
