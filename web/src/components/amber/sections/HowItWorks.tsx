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

function StepPanel({ step }: { step: (typeof STEPS)[number] }) {
  const Icon = step.icon
  return (
    <GlowCard glowCorner="top-right" className="h-full min-h-[280px] p-8">
      <div className="flex h-full flex-col justify-between">
        <div
          className={cnm(
            'flex size-12 items-center justify-center rounded-md',
            'border border-line-strong bg-surface-2 text-primary',
          )}
        >
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <div className="mt-8 md:hidden">
          <span className="font-mono text-2xl text-primary">{step.n}</span>
          <p className="display-m mt-2 text-fg">{step.title}</p>
          <p className="mt-2 text-sm text-fg-muted leading-[1.6]">
            {step.detail}
          </p>
        </div>
        <p className="hidden font-mono text-xs tracking-[0.02em] text-fg-subtle md:block">
          Step {step.n} / 0{STEPS.length}
        </p>
      </div>
    </GlowCard>
  )
}
