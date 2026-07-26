import { useQuery } from '@tanstack/react-query'
import CountUp from '@/components/amber/primitives/CountUp'
import { fetchPublicStats } from '@/lib/content-api'

function FactSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-2 px-6 py-4">
      <div className="h-3 w-16 rounded bg-surface-2" />
      <div className="h-5 w-20 rounded bg-surface-2" />
    </div>
  )
}

export default function ChainFactsStrip() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['content', 'public-stats'],
    queryFn: fetchPublicStats,
  })

  if (isError) {
    return (
      <p className="font-mono text-sm text-fg-faint">
        Live chain facts unavailable right now.
      </p>
    )
  }

  const facts = data
    ? [
        { label: 'Chain', value: data.amber.chain },
        { label: 'Chain ID', value: String(data.amber.chainId) },
        { label: 'Network', value: data.amber.network },
        {
          label: 'Identities',
          value: <CountUp to={data.usage.identities} />,
        },
        {
          label: 'Active memories',
          value: <CountUp to={data.usage.active_memories} />,
        },
      ]
    : []

  return (
    <div className="flex flex-wrap divide-x divide-line overflow-hidden rounded-2xl border border-line bg-surface">
      {isPending &&
        Array.from({ length: 5 }).map((_, i) => <FactSkeleton key={i} />)}

      {facts.map((fact) => (
        <div key={fact.label} className="flex flex-col gap-2 px-6 py-4">
          <span className="font-mono text-[0.6875rem] tracking-[0.02em] text-fg-faint uppercase">
            {fact.label}
          </span>
          <span className="font-mono text-lg text-fg">{fact.value}</span>
        </div>
      ))}
    </div>
  )
}
