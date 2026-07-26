import type { AnalyticsData } from '@/lib/reputation-api'
import { cnm } from '@/utils/style'

interface AnalyticsStripProps {
  analytics: AnalyticsData
  className?: string
}

/** Memory categories, a daily-activity sparkline, and top tags. */
export default function AnalyticsStrip({
  analytics,
  className,
}: AnalyticsStripProps) {
  const maxDaily = Math.max(1, ...analytics.dailyTimeline.map((d) => d.count))

  return (
    <div className={cnm('grid gap-6 md:grid-cols-2', className)}>
      <div className="rounded-lg border border-line bg-surface p-6">
        <p className="eyebrow">Categories</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {analytics.categoryBreakdown.length === 0 ? (
            <p className="text-sm text-fg-subtle">No memories yet.</p>
          ) : (
            analytics.categoryBreakdown.map((c) => (
              <span
                key={c.category}
                className="rounded-pill bg-surface-2 px-3 py-1.5 font-mono text-xs text-fg-secondary"
              >
                {c.category} <span className="text-fg-faint">· {c.count}</span>
              </span>
            ))
          )}
        </div>
      </div>

      <div className="rounded-lg border border-line bg-surface p-6">
        <p className="eyebrow">Activity</p>
        {analytics.dailyTimeline.length === 0 ? (
          <p className="mt-4 text-sm text-fg-subtle">No activity recorded yet.</p>
        ) : (
          <>
            <div className="mt-4 flex h-16 items-end gap-1" aria-hidden="true">
              {analytics.dailyTimeline.map((d) => (
                <span
                  key={d.day}
                  className="min-h-[3px] flex-1 rounded-t-sm bg-primary/60"
                  style={{ height: `${(d.count / maxDaily) * 100}%` }}
                />
              ))}
            </div>
            <span className="sr-only">
              {analytics.dailyTimeline
                .map((d) => `${d.day}: ${d.count} memories`)
                .join(', ')}
            </span>
          </>
        )}
        <p className="mt-3 font-mono text-xs text-fg-faint">
          {analytics.totalMemories} memories · {analytics.attestedCount} attested
        </p>
      </div>

      <div className="rounded-lg border border-line bg-surface p-6 md:col-span-2">
        <p className="eyebrow">Top tags</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {analytics.topTags.length === 0 ? (
            <p className="text-sm text-fg-subtle">No tags yet.</p>
          ) : (
            analytics.topTags.map((t) => (
              <span
                key={t.tag}
                className="rounded-pill border border-line-strong px-3 py-1.5 font-mono text-xs text-fg-muted"
              >
                #{t.tag} <span className="text-fg-faint">{t.count}</span>
              </span>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
