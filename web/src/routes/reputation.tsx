import { createFileRoute } from '@tanstack/react-router'
import PageHeader from '@/components/amber/PageHeader'
import Section from '@/components/elements/Section'
import LeaderboardGrid from '@/components/amber/reputation/LeaderboardGrid'

export const Route = createFileRoute('/reputation')({
  component: ReputationPage,
})

function ReputationPage() {
  return (
    <>
      <PageHeader
        eyebrow="On-chain reputation"
        title="A 0-100 score across six axes."
        subtitle="Every AMBER identity earns a live score from persistence, verification, economic activity, breadth, deliberateness, and longevity — attested on X Layer."
      />

      <Section>
        <LeaderboardGrid />
      </Section>
    </>
  )
}
