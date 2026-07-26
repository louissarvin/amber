import { useRef } from 'react'
import { motion, useMotionValue, useSpring } from 'motion/react'
import type { MouseEvent } from 'react'
import { SPRING_SMOOTH_TWO } from '@/config/animation'
import { cnm } from '@/utils/style'

type ButtonVariant = 'primary' | 'ghost'

interface BaseProps {
  children: React.ReactNode
  variant?: ButtonVariant
  className?: string
  /** Cursor-follow magnetic pull, restrained. Disabled under reduced-motion. */
  magnetic?: boolean
}

type ButtonAsLink = BaseProps & {
  href: string
  external?: boolean
  onClick?: never
  type?: never
}

type ButtonAsButton = BaseProps & {
  href?: never
  external?: never
  onClick?: () => void
  type?: 'button' | 'submit'
}

type ButtonProps = ButtonAsLink | ButtonAsButton

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-on-primary hover:bg-primary-bright active:bg-primary-press shadow-[0_0_0_1px_var(--color-primary-line)]',
  ghost:
    'border border-line-strong text-fg-secondary hover:border-primary-line hover:text-fg bg-transparent',
}

/**
 * Pill CTA with a restrained magnetic cursor-follow and, on primary, a
 * warm amber glow on hover (elevation level 4). No custom cursor —
 * this is the only cursor-linked interaction on the page.
 */
export default function Button(props: ButtonProps) {
  const { children, variant = 'primary', className, magnetic = true } = props
  const ref = useRef<HTMLElement>(null)
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const springX = useSpring(x, SPRING_SMOOTH_TWO)
  const springY = useSpring(y, SPRING_SMOOTH_TWO)

  const handleMouseMove = (e: MouseEvent<HTMLElement>) => {
    if (!magnetic || !ref.current) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const rect = ref.current.getBoundingClientRect()
    const relX = e.clientX - (rect.left + rect.width / 2)
    const relY = e.clientY - (rect.top + rect.height / 2)
    x.set(relX * 0.25)
    y.set(relY * 0.25)
  }

  const handleMouseLeave = () => {
    x.set(0)
    y.set(0)
  }

  const classes = cnm(
    'group relative inline-flex items-center justify-center gap-2 rounded-pill px-7 py-3.5',
    'font-medium tracking-wide transition-colors duration-200',
    variant === 'primary' &&
      'shadow-[0_0_0_1px_var(--color-primary-line)] hover:shadow-[0_0_0_1px_var(--color-primary-line),0_0_28px_color-mix(in_srgb,var(--color-primary)_35%,transparent)]',
    VARIANT_CLASSES[variant],
    className,
  )

  const motionProps = {
    style: { x: springX, y: springY },
    onMouseMove: handleMouseMove,
    onMouseLeave: handleMouseLeave,
    className: classes,
  }

  if ('href' in props && props.href) {
    const isExternal = props.external ?? props.href.startsWith('http')
    return (
      <motion.a
        ref={ref as React.Ref<HTMLAnchorElement>}
        href={props.href}
        target={isExternal ? '_blank' : undefined}
        rel={isExternal ? 'noopener noreferrer' : undefined}
        {...motionProps}
      >
        {children}
      </motion.a>
    )
  }

  return (
    <motion.button
      ref={ref as React.Ref<HTMLButtonElement>}
      type={props.type ?? 'button'}
      onClick={props.onClick}
      {...motionProps}
    >
      {children}
    </motion.button>
  )
}
