import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import RadarChart from '@/components/amber/RadarChart'
import GlowCard from '@/components/amber/primitives/GlowCard'
import PillBadge from '@/components/amber/primitives/PillBadge'
import {
  buildRadarAxes,
  fetchReputation,
  resolveLeaderboardAddress,
  type LeaderboardEntry,
} from '@/lib/reputation-api'
import { cnm } from '@/utils/style'

interface AgentCardProps {
  entry: LeaderboardEntry
  className?: string
}

/**
 * One leaderboard row. Most identities are anonymized by the API (only a
 * truncated identity, no full address) so their cards are informational
 * previews, not links. The one known full address (the demo identity) is
 * the flagship — clickable, and enriched with its live score + mini radar.
 */
export default function AgentCard({ entry, className }: AgentCardProps) {
  const fullAddress = resolveLeaderboardAddress(entry.identity)
  const isFlagship = fullAddress !== null

  const { data: reputation, isLoading } = useQuery({
    queryKey: ['reputation', fullAddress],
    queryFn: () => fetchReputation(fullAddress as string),
    enabled: isFlagship,
    staleTime: 60_000,
  })

  const content = (
    <>
      <div className="flex items-start justify-between gap-4">
        <span className="font-mono text-xs text-fg-faint">
          #{String(entry.rank).padStart(2, '0')}
        </span>
        {isFlagship ? (
          <PillBadge dot>live</PillBadge>
        ) : (
          <span className="rounded-pill border border-line-strong px-3 py-1 font-mono text-[0.6875rem] text-fg-faint">
            preview
          </span>
        )}
      </div>

      <p className="mt-4 truncate font-mono text-lg text-fg">
        {entry.identity}
      </p>
      <p className="mt-1 font-mono text-xs text-fg-subtle">
        {entry.memoryCount} {entry.memoryCount === 1 ? 'memory' : 'memories'}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {entry.categories.map((category) => (
          <span
            key={category}
            className="rounded-pill bg-surface-2 px-3 py-1 font-mono text-[0.6875rem] text-fg-subtle"
          >
            {category}
          </span>
        ))}
      </div>

      {isFlagship && (
        <div className="mt-6 flex items-center gap-4 border-t border-line pt-6">
          {isLoading || !reputation ? (
            <div className="size-16 shrink-0 animate-pulse rounded-full bg-surface-2" />
          ) : reputation.breakdown ? (
            <RadarChart axes={buildRadarAxes(reputation)} size={64} />
          ) : null}
          {reputation && (
            <div>
              <p className="font-display text-2xl text-fg">
                {reputation.score}
                <span className="ml-1 font-mono text-sm text-fg-faint">
                  /100
                </span>
              </p>
              <p className="font-mono text-xs text-fg-subtle">
                {reputation.tierIcon} {reputation.tier}
              </p>
            </div>
          )}
        </div>
      )}
    </>
  )

  if (isFlagship && fullAddress) {
    return (
      <Link
        to="/reputation/$agentId"
        params={{ agentId: fullAddress }}
        className={cnm('reveal-item block h-full', className)}
      >
        <GlowCard className="h-full p-6 transition-shadow duration-300 hover:shadow-[0_0_0_1px_var(--color-primary-line),0_0_24px_color-mix(in_srgb,var(--color-primary)_25%,transparent)]">
          {content}
        </GlowCard>
      </Link>
    )
  }

  return (
    <article
      className={cnm(
        'reveal-item rounded-lg border border-line bg-surface p-6 opacity-90',
        className,
      )}
    >
      {content}
    </article>
  )
}
