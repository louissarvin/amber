import { useEffect, useRef, useState } from 'react'
import { animate } from 'motion/react'
import { SPRING_BOUNCE_ONE } from '@/config/animation'

interface CountUpProps {
  to: number
  className?: string
  /** Decimal places to render */
  decimals?: number
  suffix?: string
}

/**
 * Spring count-up on scroll-into-view. The one "alive"/bouncy motion on
 * the page — everywhere else is expo/quint-out per the motion language.
 */
export default function CountUp({
  to,
  className,
  decimals = 0,
  suffix = '',
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const [value, setValue] = useState(0)
  const hasRun = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches

    if (reduceMotion) {
      setValue(to)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry.isIntersecting && !hasRun.current) {
          hasRun.current = true
          animate(0, to, {
            ...SPRING_BOUNCE_ONE,
            onUpdate: (latest) => setValue(latest),
          })
        }
      },
      { threshold: 0.4 },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [to])

  return (
    <span ref={ref} className={className}>
      {value.toFixed(decimals)}
      {suffix}
    </span>
  )
}
