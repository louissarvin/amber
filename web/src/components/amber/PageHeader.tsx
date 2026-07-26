import Section from '@/components/elements/Section'
import Blob from '@/components/elements/Blob'
import Eyebrow from '@/components/amber/primitives/Eyebrow'
import TextReveal from '@/components/amber/primitives/TextReveal'
import { cnm } from '@/utils/style'

interface PageHeaderProps {
  eyebrow: string
  title: string
  subtitle?: string
  /** Optional content below the subtitle — CTAs, stats, a search bar. */
  children?: React.ReactNode
  className?: string
}

/**
 * Shared inner-page hero. Sits at the top of every non-landing route:
 * eyebrow + one Display XL headline (line-mask reveal) + subtitle + an
 * optional slot, on a soft drifting amber blob. Padded to clear the
 * fixed pill navbar.
 */
export default function PageHeader({
  eyebrow,
  title,
  subtitle,
  children,
  className,
}: PageHeaderProps) {
  return (
    <Section
      className={cnm('relative overflow-hidden pt-36 md:pt-48', className)}
    >
      <Blob
        tone="amber"
        size={520}
        opacity={0.14}
        className="-top-40 left-1/2 -translate-x-1/2"
      />

      <div className="relative max-w-2xl">
        <Eyebrow>{eyebrow}</Eyebrow>

        <TextReveal as="h1" className="display-xl mt-4 text-fg" delay={80}>
          {title}
        </TextReveal>

        {subtitle && (
          <p className="mt-6 max-w-xl text-[1.1875rem] leading-[1.6] text-fg-secondary">
            {subtitle}
          </p>
        )}

        {children && <div className="mt-10">{children}</div>}
      </div>
    </Section>
  )
}
