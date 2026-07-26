import { Link } from '@tanstack/react-router'
import Container from '@/components/elements/Container'

const FOOTER_LINKS = [
  { label: 'How it works', to: '/how-it-works' as const },
  { label: 'Reputation', to: '/reputation' as const },
  { label: 'Portraits', to: '/portraits' as const },
  { label: 'Developers', to: '/developers' as const },
  { label: 'Pricing', to: '/pricing' as const },
]

/**
 * Global bottom footer bar. Rendered once from the root layout, beneath
 * every route. The landing page's big CTA well (FooterCTA) sits above
 * this, but this bar itself must only ever render a single time.
 */
export default function Footer() {
  return (
    <footer className="border-t border-line bg-bg-raised">
      <Container className="flex flex-col gap-6 py-10 md:flex-row md:items-center md:justify-between">
        <div className="font-mono text-xs text-fg-faint">
          <p>AMBER · Persistent memory + on-chain reputation</p>
          <p className="mt-1">X Layer · Chain 196 · x402 · ERC-8004</p>
        </div>

        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-fg-subtle">
          {FOOTER_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="transition-colors hover:text-fg"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </Container>
    </footer>
  )
}
