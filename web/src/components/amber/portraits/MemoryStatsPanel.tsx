import type {
  AnalyticsData,
  CategoryBreakdownEntry,
  DailyTimelineEntry,
  TopTagEntry,
} from '@/lib/portraits-api'
import CountUp from '@/components/amber/primitives/CountUp'
import Eyebrow from '@/components/amber/primitives/Eyebrow'
import { cnm } from '@/utils/style'

const AXIS_HUE_VARS = [
  '--color-axis-persistence',
  '--color-axis-verification',
  '--color-axis-economic',
  '--color-axis-breadth',
  '--color-axis-deliberateness',
  '--color-axis-longevity',
] as const

interface MemoryStatsPanelProps {
  analytics: AnalyticsData
  className?: string
}

export default function MemoryStatsPanel({
  analytics,
  className,
}: MemoryStatsPanelProps) {
  return (
    <div className={cnm('grid gap-10 md:grid-cols-2', className)}>
      <div>
        <Eyebrow>Memories</Eyebrow>
        <p className="display-m mt-3 text-fg">
          <CountUp to={analytics.totalMemories} />
          <span className="ml-2 font-mono text-lg text-fg-faint">total</span>
        </p>
        <dl className="mt-6 flex gap-8 font-mono text-[0.8125rem] text-fg-muted">
          <div>
            <dt className="text-fg-faint">attested</dt>
            <dd className="mt-1 text-fg-secondary">
              {analytics.attestedCount}
            </dd>
          </div>
          <div>
            <dt className="text-fg-faint">pending</dt>
            <dd className="mt-1 text-fg-secondary">
              {analytics.pendingAttestation}
            </dd>
          </div>
        </dl>

        <div className="mt-8">
          <Timeline entries={analytics.dailyTimeline} />
        </div>
      </div>

      <div className="flex flex-col gap-8">
        <CategoryBars categories={analytics.categoryBreakdown} />
        <TagChips tags={analytics.topTags} />
      </div>
    </div>
  )
}

function CategoryBars({
  categories,
}: {
  categories: Array<CategoryBreakdownEntry>
}) {
  if (categories.length === 0) {
    return (
      <p className="font-mono text-[0.8125rem] text-fg-faint">
        no categories yet
      </p>
    )
  }

  const max = Math.max(...categories.map((c) => c.count))

  return (
    <div>
      <p className="font-mono text-[0.6875rem] tracking-[0.02em] text-fg-faint uppercase">
        By category
      </p>
      <div className="mt-3 flex flex-col gap-3">
        {categories.map((cat, i) => {
          const hueVar = AXIS_HUE_VARS[i % AXIS_HUE_VARS.length]
          const pct = max > 0 ? Math.max((cat.count / max) * 100, 6) : 0
          return (
            <div key={cat.category} className="flex items-center gap-3">
              <span className="w-24 shrink-0 truncate font-mono text-[0.75rem] text-fg-muted">
                {cat.category}
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-pill bg-surface-2">
                <div
                  className="h-full rounded-pill"
                  style={{ width: `${pct}%`, backgroundColor: `var(${hueVar})` }}
                />
              </div>
              <span className="w-6 shrink-0 text-right font-mono text-[0.75rem] text-fg-subtle">
                {cat.count}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TagChips({ tags }: { tags: Array<TopTagEntry> }) {
  if (tags.length === 0) {
    return (
      <p className="font-mono text-[0.8125rem] text-fg-faint">
        no tags yet
      </p>
    )
  }

  return (
    <div>
      <p className="font-mono text-[0.6875rem] tracking-[0.02em] text-fg-faint uppercase">
        Top tags
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {tags.map((tag) => (
          <span
            key={tag.tag}
            className="inline-flex items-center gap-1.5 rounded-pill border border-line-strong bg-surface/60 px-3 py-1 font-mono text-[0.6875rem] text-fg-muted"
          >
            {tag.tag}
            <span className="text-fg-faint">{tag.count}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function Timeline({ entries }: { entries: Array<DailyTimelineEntry> }) {
  if (entries.length === 0) {
    return (
      <p className="font-mono text-[0.8125rem] text-fg-faint">
        no activity yet
      </p>
    )
  }

  const width = 100
  const height = 28
  const counts = entries.map((e) => e.count)
  const max = Math.max(...counts, 1)
  const min = Math.min(...counts, 0)
  const range = max - min || 1

  const points = entries.map((entry, i) => {
    const x = entries.length === 1 ? width / 2 : (i / (entries.length - 1)) * width
    const y = height - ((entry.count - min) / range) * height
    return { x, y }
  })

  const path = points.map((p) => `${p.x},${p.y}`).join(' ')

  return (
    <div>
      <p className="font-mono text-[0.6875rem] tracking-[0.02em] text-fg-faint uppercase">
        Daily activity
      </p>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="mt-3 h-16 w-full"
        role="img"
        aria-label="Sparkline of daily memory activity"
      >
        {points.length > 1 ? (
          <polyline
            points={path}
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={1.6}
            fill="var(--color-primary-bright)"
          />
        ))}
      </svg>
      <div className="mt-1 flex justify-between font-mono text-[0.625rem] text-fg-faint">
        <span>{entries[0].day}</span>
        <span>{entries[entries.length - 1].day}</span>
      </div>
    </div>
  )
}
