import { createFileRoute } from '@tanstack/react-router'
import Section from '@/components/elements/Section'
import PageHeader from '@/components/amber/PageHeader'
import Eyebrow from '@/components/amber/primitives/Eyebrow'
import PillarsGrid from '@/components/amber/content/PillarsGrid'
import RequestFlowPanel from '@/components/amber/content/RequestFlowPanel'
import PositioningRow from '@/components/amber/content/PositioningRow'

export const Route = createFileRoute('/how-it-works')({
  component: HowItWorksPage,
})

function HowItWorksPage() {
  return (
    <>
      <PageHeader
        eyebrow="How it works"
        title="Identity in. Memory out. Reputation on-chain."
        subtitle="Three pillars turn a stateless agent into one with persistent memory and an earned, portable reputation."
      />

      <Section>
        <PillarsGrid />
      </Section>

      <Section room>
        <Eyebrow>The request</Eyebrow>
        <p className="display-l mt-4 max-w-2xl text-fg">
          One call. A 402. A signature. Settled.
        </p>
        <p className="mt-5 max-w-xl text-fg-muted leading-[1.6]">
          Every paid endpoint speaks x402. The first request is challenged
          with a 402 and a signed payment offer; your wallet signs an
          EIP-3009 authorization once, and the retried call settles in
          USD₮0 on X Layer — no API key, no invoice, no gas.
        </p>
        <div className="mt-10">
          <RequestFlowPanel />
        </div>
      </Section>

      <Section>
        <Eyebrow>Positioning</Eyebrow>
        <p className="display-l mt-4 max-w-2xl text-fg">
          A different lane, not a leaderboard.
        </p>
        <div className="mt-10">
          <PositioningRow />
        </div>
      </Section>
    </>
  )
}
