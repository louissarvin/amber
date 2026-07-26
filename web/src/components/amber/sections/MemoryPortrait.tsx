import { useState } from 'react'
import Section from '@/components/elements/Section'
import Blob from '@/components/elements/Blob'
import Eyebrow from '@/components/amber/primitives/Eyebrow'

const EXAMPLE_PORTRAIT_URL =
  'https://amber-mcp.xyz/portrait/0xdeadbeef000000000000000000000000deadbeef.svg'

export default function MemoryPortrait() {
  const [failed, setFailed] = useState(false)

  return (
    <Section id="memory-portrait">
      <div className="grid gap-10 md:grid-cols-[1fr_1.3fr] md:items-center md:gap-16">
        <div>
          <Eyebrow>Memory portrait</Eyebrow>
          <p className="display-l mt-4 text-fg">
            Every memory becomes part of a portrait.
          </p>
          <p className="mt-5 max-w-md text-fg-muted leading-[1.6]">
            A generative constellation, unique to every identity. Nodes are
            memories; the connections between them are how an agent's
            understanding grows.
          </p>
        </div>

        <div className="relative aspect-square overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-[0_8px_40px_rgba(0,0,0,0.5)] md:aspect-[4/3]">
          <Blob
            tone="amber"
            size={420}
            opacity={0.12}
            className="top-1/4 left-1/4"
          />

          {!failed ? (
            <img
              src={EXAMPLE_PORTRAIT_URL}
              alt="Generative memory constellation portrait for an example AMBER identity"
              loading="lazy"
              crossOrigin="anonymous"
              onError={() => setFailed(true)}
              className="relative z-10 size-full object-contain p-10"
            />
          ) : (
            <div className="relative z-10 flex size-full flex-col items-center justify-center gap-3 px-8 text-center">
              <span className="font-mono text-xs text-fg-faint">
                Portrait renders per identity at
                amber-mcp.xyz/portrait/:address.svg
              </span>
            </div>
          )}
        </div>
      </div>
    </Section>
  )
}
