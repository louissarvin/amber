import { AXIS_META, type ReputationBreakdown } from '@/lib/reputation-api'
import { useScrollBatchReveal } from '@/hooks/useScrollBatchReveal'
import { cnm } from '@/utils/style'

interface ScoreBreakdownProps {
  breakdown: ReputationBreakdown
  className?: string
}

/** The 6-axis point breakdown, each row carrying the API's own explainer note. */
export default function ScoreBreakdown({
  breakdown,
  className,
}: ScoreBreakdownProps) {
  const containerRef = useScrollBatchReveal<HTMLDivElement>()

  return (
    <div ref={containerRef} className={cnm('flex flex-col gap-3', className)}>
      {AXIS_META.map((meta) => {
        const axis = breakdown[meta.key]
        return (
          <div
            key={meta.key}
            className="reveal-item flex items-start justify-between gap-6 rounded-md border border-line bg-surface px-5 py-4"
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="mt-1.5 size-2 shrink-0 rounded-full"
                style={{ backgroundColor: `var(${meta.colorVar})` }}
              />
              <div>
                <p className="text-sm font-medium text-fg">{meta.label}</p>
                <p className="mt-1 text-sm leading-[1.6] text-fg-muted">
                  {axis.note}
                </p>
              </div>
            </div>
            <p className="shrink-0 font-mono text-sm text-fg-secondary">
              {axis.points}
              <span className="text-fg-faint">/{meta.max}</span>
            </p>
          </div>
        )
      })}
    </div>
  )
}
