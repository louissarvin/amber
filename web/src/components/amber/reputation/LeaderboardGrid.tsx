import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import AgentCard from '@/components/amber/reputation/AgentCard'
import { fetchLeaderboard } from '@/lib/reputation-api'
import { useScrollBatchReveal } from '@/hooks/useScrollBatchReveal'

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-line bg-surface p-6">
      <div className="h-3 w-8 rounded bg-surface-2" />
      <div className="mt-4 h-5 w-32 rounded bg-surface-2" />
      <div className="mt-3 h-3 w-20 rounded bg-surface-2" />
      <div className="mt-4 flex gap-2">
        <div className="h-6 w-16 rounded-pill bg-surface-2" />
        <div className="h-6 w-16 rounded-pill bg-surface-2" />
      </div>
    </div>
  )
}

/**
 * Fetches the live public leaderboard, exposes a client-side search over
 * identity/category, and batch-reveals the resulting grid on scroll.
 */
export default function LeaderboardGrid() {
  const [query, setQuery] = useState('')
  const containerRef = useScrollBatchReveal<HTMLDivElement>()

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['leaderboard'],
    queryFn: fetchLeaderboard,
    staleTime: 30_000,
  })

  const entries = data?.leaderboard ?? []

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(
      (entry) =>
        entry.identity.toLowerCase().includes(q) ||
        entry.categories.some((category) => category.toLowerCase().includes(q)),
    )
  }, [entries, query])

  return (
    <div>
      <div className="relative max-w-sm">
        <Search
          className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-fg-faint"
          aria-hidden="true"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search identity or category"
          aria-label="Search agents by identity or category"
          className="w-full rounded-pill border border-line-strong bg-surface/60 py-3 pr-4 pl-11 text-sm text-fg placeholder:text-fg-faint focus:border-primary-line focus:shadow-[0_0_0_1px_var(--color-primary-line),0_0_24px_color-mix(in_srgb,var(--color-primary)_25%,transparent)] focus:outline-none"
        />
      </div>

      {isError && (
        <p className="mt-10 rounded-lg border border-line bg-surface px-6 py-10 text-center text-sm text-fg-muted">
          Couldn&apos;t reach the leaderboard
          {error instanceof Error ? `: ${error.message}` : ''}. Try again
          shortly.
        </p>
      )}

      {isLoading && !isError && (
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      )}

      {!isLoading && !isError && filtered.length === 0 && (
        <p className="mt-10 rounded-lg border border-line bg-surface px-6 py-10 text-center text-sm text-fg-muted">
          No agents match &quot;{query}&quot;.
        </p>
      )}

      {!isLoading && !isError && filtered.length > 0 && (
        <div
          ref={containerRef}
          className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
        >
          {filtered.map((entry) => (
            <AgentCard key={entry.rank} entry={entry} />
          ))}
        </div>
      )}
    </div>
  )
}
