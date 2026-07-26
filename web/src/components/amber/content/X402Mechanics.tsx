import { FileSignature, ShieldCheck, Zap } from 'lucide-react'
import { useScrollBatchReveal } from '@/hooks/useScrollBatchReveal'

const STEPS = [
  {
    n: '01',
    title: 'Challenge',
    icon: Zap,
    detail:
      'Call a paid endpoint without payment and get a 402 back, with a signed offer: scheme, network, asset, amount, and where to pay.',
  },
  {
    n: '02',
    title: 'Sign once',
    icon: FileSignature,
    detail:
      'Your wallet signs an EIP-3009 transferWithAuthorization for that exact amount in USD₮0 — no on-chain transaction from you, no gas.',
  },
  {
    n: '03',
    title: 'Settle',
    icon: ShieldCheck,
    detail:
      'Retry the call with the signature attached. AMBER redeems it on X Layer and returns 200 with a settlement receipt.',
  },
] as const

export default function X402Mechanics() {
  const gridRef = useScrollBatchReveal<HTMLDivElement>()

  return (
    <div ref={gridRef} className="grid gap-6 md:grid-cols-3">
      {STEPS.map((step) => {
        const Icon = step.icon
        return (
          <div
            key={step.n}
            className="reveal-item rounded-lg border border-line bg-surface p-8"
          >
            <div className="flex size-12 items-center justify-center rounded-md border border-line-strong bg-surface-2 text-primary">
              <Icon className="size-5" aria-hidden="true" />
            </div>
            <span className="mt-8 block font-mono text-2xl text-primary">
              {step.n}
            </span>
            <p className="display-m mt-2 text-fg">{step.title}</p>
            <p className="mt-3 text-sm text-fg-muted leading-[1.6]">
              {step.detail}
            </p>
          </div>
        )
      })}
    </div>
  )
}
