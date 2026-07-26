import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

/**
 * Batches scroll-triggered reveals for a group of sibling elements inside a
 * container, driven by Lenis -> ScrollTrigger (see LenisSmoothScrollProvider).
 * Attach the returned ref to the container and give each direct reveal
 * target the class passed as `itemSelector`.
 */
export function useScrollBatchReveal<T extends HTMLElement>(
  itemSelector = '.reveal-item',
) {
  const containerRef = useRef<T | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches

    const items = container.querySelectorAll<HTMLElement>(itemSelector)
    if (items.length === 0) return

    if (reduceMotion) {
      gsap.set(items, { autoAlpha: 1, y: 0 })
      return
    }

    gsap.set(items, { autoAlpha: 0, y: 28 })

    const batch = ScrollTrigger.batch(items, {
      start: 'top 88%',
      once: true,
      onEnter: (batchItems) => {
        gsap.to(batchItems, {
          autoAlpha: 1,
          y: 0,
          duration: 0.8,
          ease: 'expo.out',
          stagger: 0.08,
          overwrite: true,
        })
      },
    })

    return () => {
      batch.forEach((st) => st.kill())
    }
  }, [itemSelector])

  return containerRef
}
