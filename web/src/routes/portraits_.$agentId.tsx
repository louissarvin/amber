import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowUpRight } from 'lucide-react'
import PageHeader from '@/components/amber/PageHeader'
import Section from '@/components/elements/Section'
import Blob from '@/components/elements/Blob'
import PillBadge from '@/components/amber/primitives/PillBadge'
import Button from '@/components/amber/primitives/Button'
import Eyebrow from '@/components/amber/primitives/Eyebrow'
import PortraitImage from '@/components/amber/portraits/PortraitImage'
import MemoryStatsPanel from '@/components/amber/portraits/MemoryStatsPanel'
import ShareCard from '@/components/amber/portraits/ShareCard'
import {
  analyticsQueryOptions,
  isFullAddress,
  portraitSvgUrl,
  whoamiQueryOptions,
} from '@/lib/portraits-api'

export const Route = createFileRoute('/portraits_/$agentId')({
  component: PortraitDetailPage,
})

function PortraitDetailPage() {
  const { agentId } = Route.useParams()

  if (!isFullAddress(agentId)) {
    return <UnknownIdentity agentId={agentId} />
  }

  return <PortraitDetail address={agentId} />
}

function UnknownIdentity({ agentId }: { agentId: string }) {
  return (
    <PageHeader
      eyebrow="Portrait"
      title="That doesn't look like an identity."
      subtitle={`"${agentId}" isn't a valid 0x + 40-hex ERC-8004 address. Portraits only render for full, known identities.`}
    >
      <Link
        to="/portraits"
        className="inline-flex items-center gap-2 font-mono text-sm text-primary transition-colors hover:text-primary-bright"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to the gallery
      </Link>
    </PageHeader>
  )
}

function PortraitDetail({ address }: { address: string }) {
  const analyticsQuery = useQuery(analyticsQueryOptions(address))
  const whoamiQuery = useQuery(whoamiQueryOptions(address))

  return (
    <>
      <PageHeader
        eyebrow="Portrait"
        title="One identity's memory, rendered."
        subtitle="Every preference, fact, and note this agent has kept becomes a single generative constellation — unique, and permanent."
      >
        <PillBadge dot>{address}</PillBadge>
      </PageHeader>

      <Section className="relative overflow-hidden">
        <Blob
          tone="amber"
          size={480}
          opacity={0.14}
          className="top-0 -left-40"
        />

        <div className="relative grid gap-10 md:grid-cols-[1fr_1.1fr] md:items-center md:gap-16">
          <div className="relative aspect-square overflow-hidden rounded-2xl border border-line-strong bg-surface p-10 shadow-[0_8px_40px_rgba(0,0,0,0.5)]">
            <PortraitImage
              identity={address}
              alt={`Memory constellation portrait for identity ${address}`}
            />
          </div>

          <div>
            <Eyebrow>Dossier</Eyebrow>
            <div className="mt-4">
              {whoamiQuery.isLoading && <DossierSkeleton />}
              {whoamiQuery.isError && (
                <p className="text-fg-muted">
                  Dossier unavailable for this identity right now.
                </p>
              )}
              {whoamiQuery.data && (
                <p className="max-w-lg leading-[1.6] whitespace-pre-line text-fg-secondary">
                  {whoamiQuery.data.summary}
                </p>
              )}
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <Button href={`/reputation/${address}`}>View reputation</Button>
              <Button href={portraitSvgUrl(address)} external variant="ghost">
                Live portrait
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </div>
      </Section>

      <Section room>
        <Eyebrow>Memory stats</Eyebrow>
        <div className="mt-8">
          {analyticsQuery.isLoading && <StatsSkeleton />}
          {analyticsQuery.isError && (
            <p className="text-fg-muted">
              Memory analytics unavailable for this identity right now.
            </p>
          )}
          {analyticsQuery.data &&
            (analyticsQuery.data.totalMemories > 0 ? (
              <MemoryStatsPanel analytics={analyticsQuery.data} />
            ) : (
              <p className="text-fg-muted">
                No memories recorded for this identity yet.
              </p>
            ))}
        </div>
      </Section>

      <Section>
        <ShareCard address={address} />
      </Section>
    </>
  )
}

function DossierSkeleton() {
  return (
    <div className="flex max-w-lg flex-col gap-2">
      {Array.from({ length: 4 }, (_, i) => (
        <div
          key={i}
          className="h-4 animate-pulse rounded-pill bg-surface-2"
          style={{ width: `${90 - i * 12}%` }}
        />
      ))}
    </div>
  )
}

function StatsSkeleton() {
  return (
    <div className="grid gap-10 md:grid-cols-2">
      <div className="h-32 animate-pulse rounded-lg bg-surface" />
      <div className="h-32 animate-pulse rounded-lg bg-surface" />
    </div>
  )
}
