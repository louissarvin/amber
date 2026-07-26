import { useQueries } from '@tanstack/react-query'
import { ArrowUpRight } from 'lucide-react'
import type { VerticalKey } from '@/lib/content-api'
import GlowCard from '@/components/amber/primitives/GlowCard'
import { fetchVerticalDemo } from '@/lib/content-api'
import { config } from '@/config'

const VERTICALS: Array<{ key: VerticalKey; label: string }> = [
  { key: 'professional_asset', label: 'Professional assets' },
  { key: 'resume', label: 'Resume & career' },
  { key: 'creative', label: 'Creative' },
  { key: 'software', label: 'Software' },
  { key: 'prediction', label: 'Prediction markets' },
]

function CardSkeleton() {
  return (
    <div className="h-full animate-pulse rounded-lg border border-line bg-surface p-8">
      <div className="h-3 w-24 rounded bg-surface-2" />
      <div className="mt-6 h-5 w-40 rounded bg-surface-2" />
      <div className="mt-4 h-16 w-full rounded bg-surface-2" />
    </div>
  )
}

export default function VerticalCards() {
  const results = useQueries({
    queries: VERTICALS.map((v) => ({
      queryKey: ['content', 'vertical-demo', v.key],
      queryFn: () => fetchVerticalDemo(v.key),
    })),
  })

  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {VERTICALS.map((vertical, i) => {
        const { data, isPending, isError } = results[i]

        if (isPending) return <CardSkeleton key={vertical.key} />

        if (isError) {
          return (
            <GlowCard key={vertical.key} className="h-full p-8">
              <p className="font-mono text-[0.6875rem] tracking-[0.02em] text-fg-faint uppercase">
                {vertical.label}
              </p>
              <p className="mt-4 text-sm text-fg-muted">
                Live demo unavailable right now.
              </p>
            </GlowCard>
          )
        }

        return (
          <GlowCard
            key={vertical.key}
            glowCorner="top-right"
            className="flex h-full flex-col p-8"
          >
            <p className="font-mono text-[0.6875rem] tracking-[0.02em] text-fg-faint uppercase">
              {vertical.label}
            </p>
            <h3 className="display-m mt-3 text-fg">{data.sampleMemory.subject}</h3>
            <p className="mt-4 text-sm text-fg-muted leading-[1.6]">
              {data.useCase}
            </p>

            <div className="mt-6 rounded-md border border-line bg-surface-2 p-4">
              <p className="font-mono text-[0.6875rem] tracking-[0.02em] text-fg-faint uppercase">
                What it remembers
              </p>
              <p className="mt-2 text-sm text-fg-secondary leading-[1.6]">
                {data.sampleMemory.content}
              </p>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              {data.recommendedTools.map((tool) => (
                <span
                  key={tool}
                  className="rounded-pill border border-line-strong px-2.5 py-1 font-mono text-[0.6875rem] text-fg-subtle"
                >
                  {tool}
                </span>
              ))}
            </div>

            <a
              href={config.links.marketplace}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-primary transition-colors hover:text-primary-bright"
            >
              Explore on OKX.AI
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </a>
          </GlowCard>
        )
      })}
    </div>
  )
}
