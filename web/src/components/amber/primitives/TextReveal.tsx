import { useEffect, useLayoutEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { SplitText } from 'gsap/SplitText'
import { cnm } from '@/utils/style'

gsap.registerPlugin(SplitText)

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect

interface TextRevealProps {
  children: string
  as?: 'h1' | 'h2' | 'p'
  className?: string
  /** Delay before the reveal starts, ms */
  delay?: number
}

/**
 * Blur-to-focus headline reveal (ref: sui.io hero). Splits into words,
 * animates blur + opacity + y with a short stagger. SSR-safe: renders
 * plain text first, animates only after mount, skips entirely under
 * prefers-reduced-motion.
 */
export default function TextReveal({
  children,
  as = 'h1',
  className,
  delay = 0,
}: TextRevealProps) {
  const ref = useRef<HTMLHeadingElement>(null)

  useIsomorphicLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return
    }

    const split = SplitText.create(el, { type: 'words', mask: 'words' })

    gsap.set(split.words, { filter: 'blur(14px)', opacity: 0, y: 16 })

    const tween = gsap.to(split.words, {
      filter: 'blur(0px)',
      opacity: 1,
      y: 0,
      duration: 1,
      ease: 'expo.out',
      stagger: 0.06,
      delay: delay / 1000,
    })

    return () => {
      tween.kill()
      split.revert()
    }
  }, [children, delay])

  const Comp = as
  return (
    <Comp ref={ref} className={cnm(className)}>
      {children}
    </Comp>
  )
}
