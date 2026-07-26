import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BrainCircuit, Radar, Search } from 'lucide-react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Container from '@/components/elements/Container'
import Eyebrow from '@/components/amber/primitives/Eyebrow'
import GlowCard from '@/components/amber/primitives/GlowCard'
import { cnm } from '@/utils/style'

gsap.registerPlugin(ScrollTrigger)

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect

const STEPS = [
  {
    n: '01',
    title: 'Remember',
    detail:
      'Pass your ERC-8004 identity. Write and recall memories over MCP or REST — no accounts, no passwords.',
    icon: BrainCircuit,
  },
  {
    n: '02',
    title: 'Earn reputation',
    detail:
      "Every job attests on X Layer. Six axes compound into a 0-100 score that's yours, not the platform's.",
    icon: Radar,
  },
  {
    n: '03',
    title: 'Get discovered',
    detail:
      'Agents with earned reputation surface first in the OKX AI marketplace — trust, priced in USD₮0.',
    icon: Search,
  },
] as const

export default function HowItWorks() {
  const pinRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [activeStep, setActiveStep] = useState(0)
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    setReduceMotion(
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    )
  }, [])

  useIsomorphicLayoutEffect(() => {
    if (reduceMotion) return
    const pin = pinRef.current
    const track = trackRef.current
    if (!pin || !track) return

    const count = STEPS.length

    const trigger = ScrollTrigger.create({
      trigger: pin,
      start: 'top top',
      end: () => `+=${window.innerHeight * (count - 1) * 1.1}`,
      pin: true,
      scrub: 0.5,
      onUpdate: (self) => {
        gsap.set(track, {
          xPercent: -self.progress * ((count - 1) / count) * 100,
        })
        setActiveStep(Math.min(count - 1, Math.floor(self.progress * count)))
      },
    })

    return () => trigger.kill()
  }, [reduceMotion])

  return (
    <section
      id="how-it-works"
      ref={pinRef}
      className="relative overflow-hidden bg-bg py-24 md:py-0"
    >
      <div className="md:flex md:h-screen md:flex-col md:justify-center">
        <Container>
          <Eyebrow>How it works</Eyebrow>
          <p className="display-l mt-4 max-w-2xl text-fg">
            Identity in. Memory out. Reputation on-chain.
          </p>

          <div className="mt-14 grid gap-10 md:grid-cols-[minmax(0,220px)_1fr] md:items-center md:gap-16">
            {!reduceMotion && (
              <div className="hidden md:block">
                <span className="font-mono text-6xl font-medium text-primary">
                  {STEPS[activeStep].n}
                </span>
                <p className="display-m mt-3 text-fg">
                  {STEPS[activeStep].title}
                </p>
                <p className="mt-3 text-fg-muted leading-[1.6]">
                  {STEPS[activeStep].detail}
                </p>
              </div>
            )}

            {reduceMotion ? (
              <div className="grid gap-6 sm:grid-cols-3">
                {STEPS.map((step) => (
                  <StepPanel key={step.n} step={step} />
                ))}
              </div>
            ) : (
              <div className="overflow-hidden">
                <div
                  ref={trackRef}
                  className="flex gap-6"
                  style={{ width: `${STEPS.length * 100}%` }}
                >
                  {STEPS.map((step) => (
                    <div
                      key={step.n}
                      className="shrink-0 md:px-2"
                      style={{ width: `${100 / STEPS.length}%` }}
                    >
                      <StepPanel step={step} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Container>
      </div>
    </section>
  )
}

function MemoryVisual() {
  const rows = [
    { label: 'Brand voice: senior engineer', tag: 'preference' },
    { label: 'Deployed on X Layer 196', tag: 'fact' },
    { label: 'Palette: amber on ink', tag: 'note' },
  ]
  return (
    <div className="w-full space-y-2.5">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-surface-2 px-2.5 py-1 font-mono text-xs text-primary">
          0xdead…beef
        </span>
        <span className="font-mono text-xs text-fg-faint">ERC-8004 identity</span>
      </div>
      {rows.map((r) => (
        <div
          key={r.label}
          className="flex items-center gap-3 rounded-xl border border-line bg-surface/40 px-3 py-2.5"
        >
          <span className="size-1.5 shrink-0 rounded-full bg-primary" />
          <span className="flex-1 truncate text-sm text-fg">{r.label}</span>
          <span className="hidden font-mono text-[10px] tracking-wide text-fg-faint uppercase sm:inline">
            {r.tag}
          </span>
          <div className="flex items-end gap-[2px]">
            {[7, 12, 5, 14, 8, 11].map((h, j) => (
              <span
                key={j}
                className="w-[3px] rounded-full bg-primary/45"
                style={{ height: `${h}px` }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function ReputationVisual() {
  const R = 60
  const cx = 78
  const cy = 78
  const vals = [0.6, 0.42, 0.34, 0.92, 0.78, 0.5]
  const labels = ['P', 'V', 'E', 'B', 'D', 'L']
  const point = (i: number, r: number): [number, number] => {
    const a = ((-90 + i * 60) * Math.PI) / 180
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]
  }
  const poly = (r: number) =>
    Array.from({ length: 6 }, (_, i) => point(i, r))
      .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' ') + ' Z'
  const valPoly =
    vals
      .map((v, i) => {
        const [x, y] = point(i, v * R)
        return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ') + ' Z'
  return (
    <div className="flex w-full items-center justify-center gap-6">
      <svg viewBox="0 0 156 156" className="size-36 shrink-0" aria-hidden="true">
        {[R, R * 0.66, R * 0.33].map((r, i) => (
          <path
            key={i}
            d={poly(r)}
            fill="none"
            stroke="var(--color-line)"
            strokeOpacity={0.5 - i * 0.12}
          />
        ))}
        {Array.from({ length: 6 }, (_, i) => {
          const [x, y] = point(i, R)
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={x}
              y2={y}
              stroke="var(--color-line)"
              strokeOpacity={0.35}
            />
          )
        })}
        <path
          d={valPoly}
          fill="var(--color-primary)"
          fillOpacity={0.18}
          stroke="var(--color-primary)"
          strokeWidth={1.5}
        />
        {vals.map((v, i) => {
          const [x, y] = point(i, v * R)
          return <circle key={i} cx={x} cy={y} r={2.4} fill="var(--color-primary)" />
        })}
        {labels.map((l, i) => {
          const [x, y] = point(i, R + 11)
          return (
            <text
              key={l}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="central"
              fill="var(--color-fg-faint)"
              fontSize={8}
              fontFamily="ui-monospace, monospace"
            >
              {l}
            </text>
          )
        })}
      </svg>
      <div>
        <div className="font-mono text-5xl font-medium leading-none text-primary">
          37
        </div>
        <div className="mt-1.5 font-mono text-xs text-fg-subtle">/ 100 · active</div>
        <div className="mt-4 max-w-[9rem] font-mono text-[10px] leading-[1.5] text-fg-faint">
          Six axes attested on X Layer. Yours, not the platform's.
        </div>
      </div>
    </div>
  )
}

function DiscoveryVisual() {
  const rows = [
    { rank: 1, addr: '0xa71f…9c2e', score: 82, hot: true },
    { rank: 2, addr: '0x4b09…1d77', score: 64, hot: false },
    { rank: 3, addr: '0xde11…ee01', score: 41, hot: false },
  ]
  return (
    <div className="w-full space-y-2.5">
      {rows.map((r) => (
        <div
          key={r.rank}
          className={cnm(
            'flex items-center gap-3 rounded-xl border px-3 py-2.5',
            r.hot
              ? 'border-primary/40 bg-primary/10'
              : 'border-line bg-surface/40',
          )}
        >
          <span
            className={cnm(
              'w-6 font-mono text-xs',
              r.hot ? 'text-primary' : 'text-fg-subtle',
            )}
          >
            #{r.rank}
          </span>
          <span className="w-24 shrink-0 font-mono text-xs text-fg-muted">
            {r.addr}
          </span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className={cnm(
                'h-full rounded-full',
                r.hot ? 'bg-primary' : 'bg-primary/40',
              )}
              style={{ width: `${r.score}%` }}
            />
          </div>
          <span
            className={cnm(
              'w-6 text-right font-mono text-xs',
              r.hot ? 'text-primary' : 'text-fg-subtle',
            )}
          >
            {r.score}
          </span>
        </div>
      ))}
      <p className="pt-1 font-mono text-[10px] text-fg-faint">
        Highest reputation surfaces first in the marketplace.
      </p>
    </div>
  )
}

function StepVisual({ n }: { n: string }) {
  if (n === '01') return <MemoryVisual />
  if (n === '02') return <ReputationVisual />
  return <DiscoveryVisual />
}

function StepPanel({ step }: { step: (typeof STEPS)[number] }) {
  const Icon = step.icon
  return (
    <GlowCard glowCorner="top-right" className="h-full min-h-[320px] p-8">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between">
          <div
            className={cnm(
              'flex size-12 items-center justify-center rounded-md',
              'border border-line-strong bg-surface-2 text-primary',
            )}
          >
            <Icon className="size-5" aria-hidden="true" />
          </div>
          <p className="hidden font-mono text-xs tracking-[0.02em] text-fg-subtle md:block">
            Step {step.n} / 0{STEPS.length}
          </p>
        </div>

        <div className="mt-8 flex flex-1 items-center">
          <StepVisual n={step.n} />
        </div>

        <div className="mt-6 md:hidden">
          <span className="font-mono text-2xl text-primary">{step.n}</span>
          <p className="display-m mt-2 text-fg">{step.title}</p>
          <p className="mt-2 text-sm text-fg-muted leading-[1.6]">
            {step.detail}
          </p>
        </div>
      </div>
    </GlowCard>
  )
}
