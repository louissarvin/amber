import { useQuery } from '@tanstack/react-query'
import { Check, Minus } from 'lucide-react'
import { fetchComparables } from '@/lib/content-api'

const FEATURED = new Set([
  'ERC-8004 on-chain identity as primary key',
  'Live on-chain Reputation Score (0-100)',
  'Merkle attestation on-chain',
  'x402 pay-per-call scheme',
])

function CompetitorDot({
  name,
  value,
}: {
  name: string
  value: boolean | string
}) {
  const supported = value !== false
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[0.6875rem] text-fg-faint">
      {supported ? (
        <Check className="size-3 text-fg-subtle" aria-hidden="true" />
      ) : (
        <Minus className="size-3" aria-hidden="true" />
      )}
      {name}
    </span>
  )
}

function RowSkeleton() {
  return (
    <div className="animate-pulse border-t border-line px-6 py-5 first:border-t-0">
      <div className="h-4 w-56 rounded bg-surface-2" />
      <div className="mt-3 h-3 w-full max-w-md rounded bg-surface-2" />
    </div>
  )
}

export default function PositioningRow() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['content', 'comparables'],
    queryFn: fetchComparables,
  })

  const rows = data?.matrix.capabilities.filter((c) => FEATURED.has(c.capability))

  return (
    <div>
      <p className="max-w-2xl text-fg-secondary leading-[1.6]">
        {data?.thesis ??
          (isError
            ? "Mem0, Zep, and Letta win on retrieval benchmarks. AMBER's lane is OKX AI-native infrastructure — a different problem."
            : '')}
      </p>

      <div className="mt-10 overflow-hidden rounded-2xl border border-line bg-surface">
        {isPending &&
          Array.from({ length: 4 }).map((_, i) => <RowSkeleton key={i} />)}

        {rows?.map((row) => (
          <div
            key={row.capability}
            className="border-t border-line px-6 py-5 first:border-t-0"
          >
            <h3 className="text-sm font-medium text-fg">{row.capability}</h3>
            <p className="mt-2 font-mono text-[0.8125rem] leading-[1.5] text-primary">
              {row.amber}
            </p>
            <div className="mt-3 flex flex-wrap gap-4">
              <CompetitorDot name="Mem0" value={row.mem0} />
              <CompetitorDot name="Zep" value={row.zep} />
              <CompetitorDot name="Letta" value={row.letta} />
            </div>
          </div>
        ))}
      </div>

      {data?.verdict && (
        <p className="mt-8 max-w-2xl border-l-2 border-primary-line pl-5 text-sm text-fg-muted italic">
          {data.verdict}
        </p>
      )}
    </div>
  )
}
