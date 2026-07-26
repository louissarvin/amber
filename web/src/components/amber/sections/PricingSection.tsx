import Section from '@/components/elements/Section'
import Eyebrow from '@/components/amber/primitives/Eyebrow'
import PillBadge from '@/components/amber/primitives/PillBadge'
import { useScrollBatchReveal } from '@/hooks/useScrollBatchReveal'
import { config } from '@/config'

const ROWS = [
  {
    name: 'Memory Write',
    fee: `${config.pricing.writeUsdt} USD₮0`,
    detail: 'Store context under your identity.',
    note: `First ${config.pricing.freeWrites} free`,
  },
  {
    name: 'Memory Recall',
    fee: `${config.pricing.queryUsdt} USD₮0`,
    detail: 'Semantic top-K recall ranked by relevance.',
    note: null,
  },
  {
    name: 'Memory Bulk',
    fee: 'Free · paid over cap',
    detail: 'Import up to 50 memories in one call.',
    note: null,
  },
  {
    name: 'Session Context',
    fee: `${config.pricing.sessionUsdt} USD₮0`,
    detail: 'Bootstrap a new agent session from prior memories.',
    note: null,
  },
]

const SNIPPET = `> POST /memory/recall
< 402 Payment Required
< X-Payment-Address: 0x9c4...02af
< X-Payment-Amount: ${config.pricing.queryUsdt} USDT0
< X-Payment-Chain: 196

> X-Payment-Signature: 0x7fe1...c30d
> POST /memory/recall
< 200 OK
< X-Payment-Settled: true`

export default function PricingSection() {
  const rowsRef = useScrollBatchReveal<HTMLDivElement>()

  return (
    <Section id="pricing">
      <Eyebrow>Pricing</Eyebrow>
      <p className="display-l mt-4 max-w-2xl text-fg">
        Pay per call. Priced in USD&#8366;0.
      </p>
      <div className="mt-6">
        <PillBadge>x402 exact-scheme · settled on X Layer</PillBadge>
      </div>

      <div className="mt-14 grid gap-8 md:grid-cols-[1.2fr_1fr] md:gap-12">
        <div
          ref={rowsRef}
          className="divide-y divide-line rounded-2xl border border-line bg-surface"
        >
          {ROWS.map((row) => (
            <div
              key={row.name}
              className="reveal-item grid gap-2 p-6 md:grid-cols-[1fr_auto] md:items-baseline md:gap-8"
            >
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-medium text-fg">{row.name}</h3>
                  {row.note && (
                    <span className="rounded-pill bg-primary-soft px-2.5 py-0.5 font-mono text-[0.6875rem] text-primary">
                      {row.note}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-fg-muted">{row.detail}</p>
              </div>
              <span className="font-mono text-sm text-primary">{row.fee}</span>
            </div>
          ))}
        </div>

        <pre className="overflow-x-auto rounded-md border border-line bg-surface-2 p-6 font-mono text-[0.8125rem] leading-[1.5] text-fg-muted">
          <code>{SNIPPET}</code>
        </pre>
      </div>
    </Section>
  )
}
