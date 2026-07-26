import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Menu, X } from 'lucide-react'
import { config } from '@/config'
import { cnm } from '@/utils/style'

const NAV_LINKS = [
  { label: 'How it works', to: '/how-it-works' as const },
  { label: 'Reputation', to: '/reputation' as const },
  { label: 'Portraits', to: '/portraits' as const },
  { label: 'Developers', to: '/developers' as const },
  { label: 'Pricing', to: '/pricing' as const },
]

function Logomark() {
  return (
    <Link to="/" className="flex items-center" aria-label="AMBER home">
      <img
        src="/assets/logo.svg"
        alt="AMBER"
        width={144}
        height={81}
        className="h-10 w-auto md:h-11"
      />
    </Link>
  )
}

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!mobileOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mobileOpen])

  return (
    <>
      <div className="fixed inset-x-0 top-4 z-50 flex justify-center px-4 md:top-6">
        <nav
          className={cnm(
            'flex w-full max-w-[860px] items-center justify-between gap-6 rounded-pill border px-5 py-3',
            'backdrop-blur-xl transition-[background-color,border-color] duration-300',
            scrolled
              ? 'border-line-strong bg-surface/70'
              : 'border-line bg-surface/40',
          )}
        >
          <Logomark />

          <div className="hidden items-center gap-5 md:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="text-sm font-medium whitespace-nowrap text-fg-muted transition-colors hover:text-fg"
                activeProps={{ className: 'text-fg' }}
              >
                {link.label}
              </Link>
            ))}
          </div>

          <a
            href={config.links.marketplace}
            target="_blank"
            rel="noopener noreferrer"
            className={cnm(
              'hidden rounded-pill bg-primary px-4 py-2 text-sm font-medium whitespace-nowrap text-on-primary md:inline-flex',
              'transition-colors hover:bg-primary-bright',
            )}
          >
            Explore on OKX.AI
          </a>

          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="inline-flex size-8 items-center justify-center rounded-full text-fg-secondary md:hidden"
            aria-label="Open menu"
            aria-expanded={mobileOpen}
          >
            <Menu className="size-5" />
          </button>
        </nav>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-[60] md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-bg/80 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-4 right-4 left-4 flex flex-col rounded-2xl border border-line-strong bg-surface-3 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.7)]">
            <div className="flex items-center justify-between">
              <Logomark />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="inline-flex size-8 items-center justify-center rounded-full text-fg-secondary"
                aria-label="Close menu"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="mt-10 flex flex-col gap-6">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  onClick={() => setMobileOpen(false)}
                  className="text-2xl font-display font-semibold text-fg"
                >
                  {link.label}
                </Link>
              ))}
            </div>

            <a
              href={config.links.marketplace}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-auto inline-flex items-center justify-center rounded-pill bg-primary px-6 py-3.5 font-medium text-on-primary"
            >
              Explore on OKX.AI
            </a>
          </div>
        </div>
      )}
    </>
  )
}
