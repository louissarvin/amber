import { createFileRoute } from '@tanstack/react-router'
import { ArrowUpRight } from 'lucide-react'
import Section from '@/components/elements/Section'
import PageHeader from '@/components/amber/PageHeader'
import Eyebrow from '@/components/amber/primitives/Eyebrow'
import QuickstartPanels from '@/components/amber/content/QuickstartPanels'
import McpToolsGrid from '@/components/amber/content/McpToolsGrid'
import { config } from '@/config'

export const Route = createFileRoute('/developers')({
  component: DevelopersPage,
})

const LIVE_LINKS = [
  { label: 'agent.json (ERC-8004)', href: 'https://amber-mcp.xyz/agent.json' },
  {
    label: '.well-known/x402',
    href: 'https://amber-mcp.xyz/.well-known/x402',
  },
  { label: 'API docs', href: 'https://amber-mcp.xyz/docs' },
]

function DevelopersPage() {
  return (
    <>
      <PageHeader
        eyebrow="For developers"
        title="33 MCP tools. One identity."
        subtitle="Integrate AMBER over MCP or REST, keyed by your agent's ERC-8004 identity. One HTTP call, one x402 signature, no separate billing account."
      />

      <Section>
        <Eyebrow>Quickstart</Eyebrow>
        <p className="display-l mt-4 max-w-2xl text-fg">
          One HTTP call. Either protocol.
        </p>
        <p className="mt-5 max-w-xl text-fg-muted leading-[1.6]">
          REST and MCP hit the same identity-keyed memory store. Pick REST for
          a quick curl, MCP for a tool-calling agent client — both settle
          through the same x402 flow.
        </p>
        <div className="mt-10">
          <QuickstartPanels />
        </div>
      </Section>

      <Section room>
        <Eyebrow>REST vs MCP</Eyebrow>
        <p className="display-l mt-4 max-w-2xl text-fg">
          Same identity, same ledger, two transports.
        </p>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <div className="rounded-lg border border-line bg-surface p-6">
            <h3 className="text-sm font-medium text-fg">REST</h3>
            <p className="mt-2 text-sm text-fg-muted leading-[1.6]">
              Plain HTTP endpoints under{' '}
              <span className="font-mono text-[0.8125rem] text-primary">
                amber-mcp.xyz
              </span>
              . Good for a quick curl, a server-side integration, or any
              client that doesn't speak MCP.
            </p>
          </div>
          <div className="rounded-lg border border-line bg-surface p-6">
            <h3 className="text-sm font-medium text-fg">MCP</h3>
            <p className="mt-2 text-sm text-fg-muted leading-[1.6]">
              A2MCP transport at{' '}
              <span className="font-mono text-[0.8125rem] text-primary">
                /mcp
              </span>{' '}
              (protocol 2025-06-18). All 33 tools listed via{' '}
              <span className="font-mono text-[0.8125rem] text-primary">
                tools/list
              </span>
              — the natural fit for an agent that calls tools directly.
            </p>
          </div>
        </div>
      </Section>

      <Section>
        <Eyebrow>MCP tools</Eyebrow>
        <p className="display-l mt-4 max-w-2xl text-fg">
          Five categories, thirty-three tools.
        </p>
        <div className="mt-10">
          <McpToolsGrid />
        </div>
      </Section>

      <Section room>
        <Eyebrow>Live references</Eyebrow>
        <p className="display-l mt-4 max-w-2xl text-fg">
          The manifests, not the marketing.
        </p>
        <div className="mt-10 flex flex-col gap-3">
          {LIVE_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center justify-between rounded-lg border border-line bg-surface px-6 py-4 transition-colors hover:border-primary-line"
            >
              <span className="font-mono text-sm text-fg-secondary">
                {link.label}
              </span>
              <ArrowUpRight className="size-4 text-fg-subtle transition-colors group-hover:text-primary" />
            </a>
          ))}
          <a
            href={config.links.docs}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between rounded-lg border border-line bg-surface px-6 py-4 transition-colors hover:border-primary-line"
          >
            <span className="font-mono text-sm text-fg-secondary">
              OKX.AI tutorial
            </span>
            <ArrowUpRight className="size-4 text-fg-subtle transition-colors group-hover:text-primary" />
          </a>
        </div>
      </Section>
    </>
  )
}
