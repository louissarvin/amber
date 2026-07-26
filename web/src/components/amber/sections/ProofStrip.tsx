import Section from '@/components/elements/Section'
import Marquee from '@/components/elements/Marquee'

const ITEMS = [
  '33 MCP tools',
  'x402',
  'USD₮0',
  'X Layer 196',
  'ERC-8004',
  '6-axis reputation',
]

export default function ProofStrip() {
  return (
    <Section room className="py-12 md:py-16">
      <Marquee items={ITEMS} />
    </Section>
  )
}
