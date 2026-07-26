import { createFileRoute } from '@tanstack/react-router'
import Section from '@/components/elements/Section'
import PageHeader from '@/components/amber/PageHeader'
import Eyebrow from '@/components/amber/primitives/Eyebrow'
import PillBadge from '@/components/amber/primitives/PillBadge'
import PricingCards from '@/components/amber/content/PricingCards'
import X402Mechanics from '@/components/amber/content/X402Mechanics'
import ChainFactsStrip from '@/components/amber/content/ChainFactsStrip'

export const Route = createFileRoute('/pricing')({
  component: PricingPage,
})

function PricingPage() {
  return (
    <>
      <PageHeader
        eyebrow="Pricing"
        title="Pay per call. Priced in USD₮0."
        subtitle="Two paid tools, settled per call on X Layer. Everything else — writes, portraits, attestation checks, reputation lookups — is free."
      >
        <PillBadge dot>x402 exact scheme · settled on X Layer</PillBadge>
      </PageHeader>

      <Section>
        <PricingCards />
      </Section>

      <Section room>
        <Eyebrow>x402 mechanics</Eyebrow>
        <p className="display-l mt-4 max-w-2xl text-fg">
          Challenge. Sign once. Settle.
        </p>
        <p className="mt-5 max-w-xl text-fg-muted leading-[1.6]">
          No API keys, no invoices, no separate billing account — every paid
          call is its own micro-transaction.
        </p>
        <div className="mt-10">
          <X402Mechanics />
        </div>
      </Section>

      <Section>
        <Eyebrow>Chain facts</Eyebrow>
        <p className="display-l mt-4 max-w-2xl text-fg">Live from the chain.</p>
        <div className="mt-10">
          <ChainFactsStrip />
        </div>
      </Section>
    </>
  )
}
