import Container from '@/components/elements/Container'
import { cnm } from '@/utils/style'

interface SectionProps {
  /** Alternates the "room" background per Claude-style chapter rhythm */
  room?: boolean
  id?: string
  className?: string
  containerClassName?: string
  children: React.ReactNode
}

export default function Section({
  room = false,
  id,
  className,
  containerClassName,
  children,
}: SectionProps) {
  return (
    <section
      id={id}
      className={cnm(
        'relative py-24 md:py-40',
        room ? 'bg-bg-raised' : 'bg-bg',
        className,
      )}
    >
      <Container className={containerClassName}>{children}</Container>
    </section>
  )
}
