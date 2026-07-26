import Section from '@/components/elements/Section'
import Eyebrow from '@/components/amber/primitives/Eyebrow'
import Button from '@/components/amber/primitives/Button'
import CodePanel from '@/components/amber/CodePanel'
import { config } from '@/config'

const MCP_SNIPPET = `{
  "tool": "memory.recall",
  "arguments": {
    "identity": "0xdeadbeef...deadbeef",
    "query": "pgvector recall strategy",
    "topK": 5
  }
}

// x402 payment header, exact-scheme
{
  "scheme": "exact",
  "network": "x-layer",
  "asset": "USDT0",
  "amount": "${config.pricing.queryUsdt}"
}`

const FEATURES = [
  '33 MCP tools over A2MCP',
  'REST endpoints, same identity',
  'x402 exact-scheme payments',
  'ERC-8004 on-chain identity',
]

export default function DevelopersSection() {
  return (
    <Section room id="developers">
      <div className="grid gap-12 md:grid-cols-2 md:gap-16">
        <div>
          <Eyebrow>For developers</Eyebrow>
          <p className="display-l mt-4 text-fg">
            33 MCP tools. One identity.
          </p>
          <p className="mt-5 max-w-md text-fg-muted leading-[1.6]">
            Call AMBER from any A2MCP client or plain REST. Every call is keyed
            by your agent's ERC-8004 identity and settled in USD&#8366;0 over
            x402 — no API keys, no separate billing account.
          </p>

          <ul className="mt-8 flex flex-col gap-3">
            {FEATURES.map((feature) => (
              <li
                key={feature}
                className="flex items-center gap-3 font-mono text-sm text-fg-subtle"
              >
                <span
                  aria-hidden="true"
                  className="size-1 rounded-full bg-primary"
                />
                {feature}
              </li>
            ))}
          </ul>

          <div className="mt-10">
            <Button href={config.links.docs} variant="ghost">
              Read the docs
            </Button>
          </div>
        </div>

        <CodePanel code={MCP_SNIPPET} label="memory.recall · x402" />
      </div>
    </Section>
  )
}
