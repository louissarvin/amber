import { BookMarked, Radar, ShieldCheck } from 'lucide-react'
import GlowCard from '@/components/amber/primitives/GlowCard'
import { useScrollBatchReveal } from '@/hooks/useScrollBatchReveal'

const PILLARS = [
  {
    key: 'memory',
    n: '01',
    title: 'Persistent memory',
    icon: BookMarked,
    detail:
      'Every write is embedded (pgvector, 1024-dim) and keyed to your ERC-8004 identity, not a session or an API key. Recall is semantic top-K, ranked by relevance, callable from any MCP client or plain REST.',
    points: [
      'Write once, recall from any agent that knows your identity',
      'Semantic search, not string match',
      'No accounts — the identity is the key',
    ],
  },
  {
    key: 'reputation',
    n: '02',
    title: 'On-chain reputation',
    icon: Radar,
    detail:
      'Every job compounds into a 0-100 score across six axes: persistence, verification, economic, breadth, deliberateness, and longevity. The score is portable — it belongs to the agent, not the platform.',
    points: [
      'Six axes, each independently computed',
      'Score travels across the OKX AI marketplace',
      'Public, queryable by any counterparty',
    ],
  },
  {
    key: 'attestation',
    n: '03',
    title: 'X Layer attestation',
    icon: ShieldCheck,
    detail:
      'Memory batches anchor a Merkle root on X Layer (chain 196). Paid calls settle in USD₮0 via the x402 exact scheme — an EIP-3009 signature, no gas, no separate billing account.',
    points: [
      'Merkle root anchored on-chain, verifiable by anyone',
      'x402 exact scheme, EIP-3009 signature',
      'Gasless settlement on X Layer',
    ],
  },
] as const

export default function PillarsGrid() {
  const gridRef = useScrollBatchReveal<HTMLDivElement>()

  return (
    <div ref={gridRef} className="grid gap-6 md:grid-cols-3">
      {PILLARS.map((pillar) => {
        const Icon = pillar.icon
        return (
          <GlowCard
            key={pillar.key}
            glowCorner="top-right"
            className="reveal-item flex h-full flex-col p-8"
          >
            <div className="flex size-12 items-center justify-center rounded-md border border-line-strong bg-surface-2 text-primary">
              <Icon className="size-5" aria-hidden="true" />
            </div>
            <span className="mt-8 block font-mono text-2xl text-primary">
              {pillar.n}
            </span>
            <p className="display-m mt-2 text-fg">{pillar.title}</p>
            <p className="mt-3 text-fg-muted leading-[1.6]">{pillar.detail}</p>

            <ul className="mt-6 flex flex-col gap-2 border-t border-line pt-6">
              {pillar.points.map((point) => (
                <li
                  key={point}
                  className="flex items-start gap-2.5 text-sm text-fg-subtle"
                >
                  <span
                    aria-hidden="true"
                    className="mt-1.5 size-1 shrink-0 rounded-full bg-primary"
                  />
                  {point}
                </li>
              ))}
            </ul>
          </GlowCard>
        )
      })}
    </div>
  )
}
