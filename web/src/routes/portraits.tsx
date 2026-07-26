import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import PageHeader from '@/components/amber/PageHeader'
import Section from '@/components/elements/Section'
import Blob from '@/components/elements/Blob'
import PortraitCard from '@/components/amber/portraits/PortraitCard'
import { leaderboardQueryOptions } from '@/lib/portraits-api'
import { useScrollBatchReveal } from '@/hooks/useScrollBatchReveal'

export const Route = createFileRoute('/portraits')({
  component: PortraitsPage,
})

function PortraitsPage() {
  const { data, isLoading, isError, refetch } = useQuery(
    leaderboardQueryOptions(),
  )
  const gridRef = useScrollBatchReveal<HTMLDivElement>()

  return (
    <>
      <PageHeader
        eyebrow="Memory portraits"
        title="Every memory becomes part of a portrait."
        subtitle="Each identity's memory renders as a living constellation — nodes for what an agent has learned, lines for how it connects. This is the gallery of everyone who has one."
      />

      <Section className="relative overflow-hidden">
        <Blob
          tone="cognac"
          size={560}
          opacity={0.1}
          className="top-1/3 -right-52"
        />
        <Blob
          tone="amber"
          size={420}
          opacity={0.12}
          delay={8}
          className="-bottom-24 -left-32"
        />

        {isLoading && <GallerySkeleton />}

        {isError && (
          <div className="relative rounded-lg border border-line bg-surface p-12 text-center">
            <p className="text-fg-muted">
              Couldn't reach the portrait gallery.
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-4 font-mono text-xs text-primary transition-colors hover:text-primary-bright"
            >
              retry
            </button>
          </div>
        )}

        {data && (
          <>
            <div
              ref={gridRef}
              className="relative columns-1 gap-6 sm:columns-2 lg:columns-3"
            >
              {data.leaderboard.map((entry) => (
                <PortraitCard key={entry.rank} entry={entry} />
              ))}
            </div>

            {data.note && (
              <p className="relative mt-10 text-center font-mono text-[0.6875rem] text-fg-faint">
                {data.note}
              </p>
            )}
          </>
        )}
      </Section>
    </>
  )
}

function GallerySkeleton() {
  return (
    <div className="relative columns-1 gap-6 sm:columns-2 lg:columns-3">
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="mb-6 aspect-square animate-pulse break-inside-avoid rounded-lg border border-line bg-surface"
        />
      ))}
    </div>
  )
}
