import { ChevronDown } from 'lucide-react'
import Container from '@/components/elements/Container'
import Blob from '@/components/elements/Blob'
import Button from '@/components/amber/primitives/Button'
import PillBadge from '@/components/amber/primitives/PillBadge'
import TextReveal from '@/components/amber/primitives/TextReveal'
import { config } from '@/config'

export default function Hero() {
  return (
    <section className="relative px-4 pt-28 pb-6 md:px-6 md:pt-32">
      <Container className="px-0">
        <div className="relative min-h-[86vh] overflow-hidden rounded-2xl border border-line bg-surface px-6 py-16 md:min-h-[88vh] md:px-16 md:py-20">
          <Blob
            tone="amber"
            size={560}
            className="-top-40 -right-32"
            opacity={0.18}
          />
          <Blob
            tone="cognac"
            size={420}
            className="-bottom-32 -left-24"
            opacity={0.14}
            delay={6}
          />

          <div className="relative flex h-full min-h-[70vh] flex-col justify-center">
            <PillBadge dot className="w-fit">
              Live on X Layer · Chain 196
            </PillBadge>

            <TextReveal
              as="h1"
              className="display-xl mt-8 max-w-4xl text-fg"
              delay={120}
            >
              Agents that remember. Reputation that&rsquo;s earned.
            </TextReveal>

            <p className="mt-7 max-w-xl text-[1.1875rem] leading-[1.6] text-fg-secondary">
              Persistent memory and live on-chain reputation for the OKX AI
              agent marketplace. One HTTP call. Paid per call in USD&#8366;0 on
              X Layer.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Button href={config.links.marketplace} variant="primary">
                Explore agents
              </Button>
              <Button href={config.links.docs} variant="ghost">
                Read the docs
              </Button>
            </div>
          </div>

          <div className="absolute bottom-8 left-6 flex items-center gap-3 text-fg-faint md:left-16">
            <span className="font-mono text-[0.6875rem] tracking-[0.08em] uppercase">
              / scroll
            </span>
            <ChevronDown className="animate-bob size-3.5" aria-hidden="true" />
          </div>
        </div>
      </Container>
    </section>
  )
}
