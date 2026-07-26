import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import Section from '@/components/elements/Section'
import PageHeader from '@/components/amber/PageHeader'
import RadarChart from '@/components/amber/RadarChart'
import CountUp from '@/components/amber/primitives/CountUp'
import ScoreBreakdown from '@/components/amber/reputation/ScoreBreakdown'
import AnalyticsStrip from '@/components/amber/reputation/AnalyticsStrip'
import {
  buildRadarAxes,
  fetchAnalytics,
  fetchReputation,
  truncateAddress,
} from '@/lib/reputation-api'
import { isValidIdentity } from '@/lib/amber-api'

export const Route = createFileRoute('/reputation_/$agentId')({
  component: AgentReputationPage,
})

function AgentReputationPage() {
  const { agentId } = Route.useParams()
  const valid = isValidIdentity(agentId)

  const reputationQuery = useQuery({
    queryKey: ['reputation', agentId],
    queryFn: () => fetchReputation(agentId),
    enabled: valid,
    retry: false,
  })

  const analyticsQuery = useQuery({
    queryKey: ['reputation-analytics', agentId],
    queryFn: () => fetchAnalytics(agentId),
    enabled: valid,
    retry: false,
  })

  if (!valid) {
    return (
      <PageHeader
        eyebrow="Agent reputation"
        title="Unknown identity"
        subtitle={`"${agentId}" isn't a valid ERC-8004 identity — addresses look like 0x followed by 40 hex characters.`}
      />
    )
  }

  const reputation = reputationQuery.data
  const analytics = analyticsQuery.data
  const isLoading = reputationQuery.isLoading || analyticsQuery.isLoading
  const isError = reputationQuery.isError

  const portraitUrl =
    analytics?.portraitUrl ??
    reputation?.links?.portrait ??
    `https://amber-mcp.xyz/portrait/${agentId}.svg`

  const radarAxes = reputation ? buildRadarAxes(reputation) : []

  return (
    <>
      <PageHeader
        eyebrow="Agent reputation"
        title={truncateAddress(agentId)}
        subtitle={reputation?.summary}
      >
        {reputation && (
          <span className="inline-flex items-center gap-2 rounded-pill border border-line-strong bg-surface/60 px-4 py-1.5 font-mono text-xs text-fg-muted">
            <span className="text-primary">{reputation.tierIcon}</span>
            {reputation.tier}
          </span>
        )}
      </PageHeader>

      <Section>
        {isError && (
          <div className="rounded-lg border border-line bg-surface px-8 py-12 text-center">
            <p className="text-fg-secondary">
              This identity has no reputation data yet.
            </p>
            {reputationQuery.error instanceof Error && (
              <p className="mt-2 font-mono text-xs text-fg-faint">
                {reputationQuery.error.message}
              </p>
            )}
          </div>
        )}

        {isLoading && !isError && (
          <div className="animate-pulse space-y-6">
            <div className="h-64 rounded-2xl border border-line bg-surface" />
            <div className="h-40 rounded-2xl border border-line bg-surface" />
          </div>
        )}

        {!isLoading && !isError && reputation && (
          <div className="grid gap-10 md:grid-cols-[1fr_1.2fr] md:items-center">
            <div className="flex flex-col items-start rounded-2xl border border-line-strong bg-surface-2 p-8 shadow-[0_8px_40px_rgba(0,0,0,0.5)]">
              <div className="flex items-baseline gap-2">
                <CountUp
                  to={reputation.score}
                  className="font-display text-6xl text-fg"
                />
                <span className="font-mono text-xl text-fg-faint">/100</span>
              </div>
              <p className="mt-6 max-w-sm text-sm leading-[1.6] text-fg-muted">
                {reputation.summary}
              </p>
            </div>

            {reputation.breakdown && radarAxes.length > 0 ? (
              <RadarChart axes={radarAxes} size={320} className="mx-auto" />
            ) : (
              <div className="rounded-2xl border border-line bg-surface p-8 text-center text-sm text-fg-muted">
                {reputation.note ??
                  "No axis breakdown yet — this identity hasn't written any memories."}
              </div>
            )}
          </div>
        )}

        {!isLoading && !isError && reputation?.breakdown && (
          <div className="mt-16">
            <p className="eyebrow">Breakdown</p>
            <ScoreBreakdown
              breakdown={reputation.breakdown}
              className="mt-6"
            />
          </div>
        )}

        {!isLoading && !isError && analytics && (
          <div className="mt-16">
            <p className="eyebrow">Activity</p>
            <AnalyticsStrip analytics={analytics} className="mt-6" />
          </div>
        )}

        {!isLoading && !isError && reputation && (
          <div className="mt-16 flex flex-wrap gap-4">
            <Link
              to="/portraits"
              className="inline-flex items-center justify-center rounded-pill border border-line-strong px-7 py-3.5 font-medium text-fg-secondary transition-colors hover:border-primary-line hover:text-fg"
            >
              Portrait gallery
            </Link>
            <a
              href={portraitUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-pill bg-primary px-7 py-3.5 font-medium text-on-primary shadow-[0_0_0_1px_var(--color-primary-line)] transition-colors hover:bg-primary-bright"
            >
              View live portrait
            </a>
          </div>
        )}
      </Section>
    </>
  )
}
