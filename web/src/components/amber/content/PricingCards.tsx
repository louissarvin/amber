import { useScrollBatchReveal } from '@/hooks/useScrollBatchReveal'
import { config } from '@/config'

const PAID = [
  {
    name: 'Memory Recall',
    fee: config.pricing.queryUsdt,
    detail: 'Semantic top-K recall over your identity-keyed memory store.',
  },
  {
    name: 'Session Context',
    fee: config.pricing.sessionUsdt,
    detail: 'Bootstrap a new agent session from your most recent memories.',
  },
] as const

const FREE = [
  'Memory Write',
  'Memory Bulk Write',
  'Memory List / Get',
  'Portrait & Seal generation',
  'Attestation verification',
  'Identity & reputation lookup',
  'Vertical copilots (finance, lifestyle, daily brief)',
]

export default function PricingCards() {
  const gridRef = useScrollBatchReveal<HTMLDivElement>()

  return (
    <div ref={gridRef} className="grid gap-6 md:grid-cols-2">
      {PAID.map((row) => (
        <div
          key={row.name}
          className="reveal-item rounded-2xl border border-line bg-surface p-8 transition-shadow hover:shadow-[0_0_0_1px_var(--color-primary-line),0_0_24px_color-mix(in_srgb,var(--color-primary)_25%,transparent)]"
        >
          <h3 className="text-lg font-medium text-fg">{row.name}</h3>
          <p className="mt-4 font-mono text-3xl text-primary">
            {row.fee}
            <span className="ml-2 text-sm text-fg-subtle">USD₮0 / call</span>
          </p>
          <p className="mt-4 text-sm text-fg-muted leading-[1.6]">
            {row.detail}
          </p>
        </div>
      ))}

      <div className="reveal-item rounded-2xl border border-line bg-surface p-8 md:col-span-2">
        <h3 className="text-lg font-medium text-fg">Everything else, free</h3>
        <p className="mt-2 text-sm text-fg-muted leading-[1.6]">
          The other 31 MCP tools — writes, portraits, attestation checks,
          reputation lookups, vertical copilots — carry no per-call charge.
        </p>
        <ul className="mt-6 grid gap-x-8 gap-y-2 sm:grid-cols-2">
          {FREE.map((item) => (
            <li
              key={item}
              className="flex items-center gap-2.5 font-mono text-[0.8125rem] text-fg-subtle"
            >
              <span
                aria-hidden="true"
                className="size-1 shrink-0 rounded-full bg-success"
              />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
