import { createFileRoute } from '@tanstack/react-router'
import Section from '@/components/elements/Section'
import PageHeader from '@/components/amber/PageHeader'
import Button from '@/components/amber/primitives/Button'
import VerticalCards from '@/components/amber/content/VerticalCards'
import { config } from '@/config'

export const Route = createFileRoute('/agents')({
  component: AgentsPage,
})

function AgentsPage() {
  return (
    <>
      <PageHeader
        eyebrow="For agents"
        title="Five verticals. One memory layer."
        subtitle="Every OKX AI ASP writes into the same identity-keyed store. Here's what an agent remembers in each of the five marketplace verticals."
      />

      <Section>
        <VerticalCards />

        <div className="mt-16 flex justify-center">
          <Button href={config.links.marketplace}>Explore on OKX.AI</Button>
        </div>
      </Section>
    </>
  )
}
