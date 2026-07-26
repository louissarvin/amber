import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

export interface RadarAxis {
  key: string
  label: string
  value: number
  colorVar: string
}

interface RadarChartProps {
  axes: Array<RadarAxis>
  size?: number
  className?: string
}

const CENTER = 50
const MAX_R = 40
const RINGS = [0.33, 0.66, 1]

function pointAt(angleDeg: number, r: number) {
  const rad = (angleDeg - 90) * (Math.PI / 180)
  return { x: CENTER + r * Math.cos(rad), y: CENTER + r * Math.sin(rad) }
}

/**
 * 6-axis reputation radar. Grid + filled shape render immediately; the six
 * value spokes draw axis-by-axis (strokeDashoffset) once scrolled into view.
 */
export default function RadarChart({
  axes,
  size = 320,
  className,
}: RadarChartProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const spokeRefs = useRef<Array<SVGLineElement | null>>([])

  const angleStep = 360 / axes.length
  const gridPoints = RINGS.map((ring) =>
    axes.map((_, i) => pointAt(i * angleStep, MAX_R * ring)),
  )
  const shapePoints = axes.map((axis, i) =>
    pointAt(i * angleStep, MAX_R * (axis.value / 100)),
  )

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return

    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches

    const lines = spokeRefs.current.filter(
      (l): l is SVGLineElement => l !== null,
    )

    if (reduceMotion) {
      lines.forEach((l) => l.style.setProperty('stroke-dashoffset', '0'))
      return
    }

    lines.forEach((l) => {
      const len = l.getTotalLength()
      l.style.strokeDasharray = `${len}`
      l.style.strokeDashoffset = `${len}`
    })

    const trigger = ScrollTrigger.create({
      trigger: svg,
      start: 'top 75%',
      once: true,
      onEnter: () => {
        gsap.to(lines, {
          strokeDashoffset: 0,
          duration: 0.7,
          ease: 'expo.out',
          stagger: 0.12,
        })
      },
    })

    return () => trigger.kill()
  }, [axes])

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="Six-axis reputation radar"
    >
      {gridPoints.map((ring, ringIdx) => (
        <polygon
          key={ringIdx}
          points={ring.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke="var(--color-line-strong)"
          strokeWidth={0.3}
        />
      ))}

      {axes.map((_, i) => {
        const outer = pointAt(i * angleStep, MAX_R)
        return (
          <line
            key={`axis-${i}`}
            x1={CENTER}
            y1={CENTER}
            x2={outer.x}
            y2={outer.y}
            stroke="var(--color-line)"
            strokeWidth={0.3}
          />
        )
      })}

      <polygon
        points={shapePoints.map((p) => `${p.x},${p.y}`).join(' ')}
        fill="color-mix(in srgb, var(--color-primary) 16%, transparent)"
        stroke="var(--color-primary)"
        strokeWidth={0.6}
      />

      {axes.map((axis, i) => {
        const target = shapePoints[i]
        return (
          <line
            key={axis.key}
            ref={(el) => {
              spokeRefs.current[i] = el
            }}
            x1={CENTER}
            y1={CENTER}
            x2={target.x}
            y2={target.y}
            stroke={`var(${axis.colorVar})`}
            strokeWidth={1}
            strokeLinecap="round"
          />
        )
      })}

      {axes.map((axis, i) => {
        const target = shapePoints[i]
        return (
          <circle
            key={`dot-${axis.key}`}
            cx={target.x}
            cy={target.y}
            r={1.6}
            fill={`var(${axis.colorVar})`}
          />
        )
      })}
    </svg>
  )
}
