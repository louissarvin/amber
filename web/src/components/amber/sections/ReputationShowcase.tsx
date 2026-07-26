import { useQuery } from '@tanstack/react-query'
import RadarChart from '@/components/amber/RadarChart'
import Section from '@/components/elements/Section'
import Eyebrow from '@/components/amber/primitives/Eyebrow'
import CountUp from '@/components/amber/primitives/CountUp'
import { useScrollBatchReveal } from '@/hooks/useScrollBatchReveal'
import {
  AXIS_META,
  DEMO_AGENT_ADDRESS,
  buildRadarAxes,
  fetchReputation,
} from '@/lib/reputation-api'

/** Live reputation for the flagship demo identity — the same one shown
 * throughout /reputation and /portraits, so the landing page's showcase
 * reflects real backend state rather than an illustrative mock. */
export default function ReputationShowcase() {
  const listRef = useScrollBatchReveal<HTMLUListElement>()

  const { data, isError } = useQuery({
    queryKey: ['reputation', DEMO_AGENT_ADDRESS],
    queryFn: () => fetchReputation(DEMO_AGENT_ADDRESS),
    staleTime: 60_000,
  })

  const radarAxes = data ? buildRadarAxes(data) : []
  const hasData = data !== undefined && radarAxes.length > 0

  return (
    <Section room id="reputation">
      <Eyebrow>Reputation</Eyebrow>
      <p className="display-l mt-4 max-w-2xl text-fg">
        A 0-100 score across six axes.
      </p>

      <div className="mt-14 grid gap-10 rounded-2xl border border-line bg-surface p-8 md:grid-cols-[auto_1fr] md:items-center md:gap-16 md:p-12">
        <div className="relative flex justify-center">
          {hasData ? (
            <>
              <RadarChart axes={radarAxes} size={280} />
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="display-l text-fg">
                  <CountUp to={data.score} />
                </span>
                <span className="font-mono text-sm text-fg-subtle">/100</span>
              </div>
            </>
          ) : (
            <div className="size-[280px] animate-pulse rounded-full border border-line-strong bg-surface-2" />
          )}
        </div>

        <div>
          <p className="font-mono text-xs tracking-[0.02em] text-fg-faint">
            {hasData
              ? `Live identity · ${data.tier}`
              : isError
                ? 'Live reputation unavailable right now.'
                : 'Loading live reputation…'}
          </p>
          <ul ref={listRef} className="mt-4 divide-y divide-line">
            {(hasData ? radarAxes : AXIS_META).map((axis) => (
              <li
                key={axis.key}
                className="reveal-item flex items-center justify-between gap-4 py-4"
              >
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: `var(${axis.colorVar})` }}
                  />
                  <span className="text-sm font-medium text-fg-secondary">
                    {axis.label}
                  </span>
                </div>
                <span className="font-mono text-sm text-fg-muted">
                  {'value' in axis ? Math.round(axis.value) : '—'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  )
}
