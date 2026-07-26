import { Link } from '@tanstack/react-router'
import { motion, useReducedMotion } from 'motion/react'
import PortraitImage from './PortraitImage'
import type { LeaderboardEntry } from '@/lib/portraits-api'
import GlowCard from '@/components/amber/primitives/GlowCard'
import { resolveFullAddress } from '@/lib/portraits-api'
import { SPRING_SMOOTH_TWO } from '@/config/animation'
import { cnm } from '@/utils/style'

interface PortraitCardProps {
  entry: LeaderboardEntry
  className?: string
}

/**
 * One gallery tile. Deep-links to `/portraits/$agentId` only when the
 * identity resolves to a full address we independently know (the
 * flagship demo) — truncated-only rows render as a non-clickable preview.
 */
export default function PortraitCard({ entry, className }: PortraitCardProps) {
  const reduceMotion = useReducedMotion()
  const fullAddress = resolveFullAddress(entry.identity)

  const card = (
    <GlowCard
      className="p-5 transition-[border-color,box-shadow] duration-300 hover:border-line-strong"
      glowCorner={entry.rank % 2 === 0 ? 'bottom-left' : 'top-right'}
    >
      <div className="relative aspect-square overflow-hidden rounded-md border border-line bg-surface-2">
        <PortraitImage
          identity={fullAddress ?? entry.identity}
          alt={`Memory constellation portrait for identity ${entry.identity}`}
          className="p-4"
        />
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="truncate font-mono text-[0.8125rem] text-fg-secondary">
          {entry.identity}
        </span>
        <span className="shrink-0 font-mono text-[0.6875rem] text-fg-faint">
          #{entry.rank}
        </span>
      </div>

      <p className="mt-1.5 font-mono text-[0.6875rem] text-fg-subtle">
        {entry.memoryCount} {entry.memoryCount === 1 ? 'memory' : 'memories'}
      </p>

      {!fullAddress && (
        <span className="mt-3 inline-block rounded-pill border border-line-strong px-2.5 py-0.5 font-mono text-[0.625rem] tracking-[0.02em] text-fg-faint">
          preview
        </span>
      )}
    </GlowCard>
  )

  const wrapperClassName = cnm(
    'reveal-item mb-6 break-inside-avoid',
    !fullAddress && 'cursor-default',
    className,
  )

  const motionWhileHover =
    reduceMotion || !fullAddress ? undefined : { y: -6, scale: 1.015 }

  return (
    <motion.div
      className={wrapperClassName}
      whileHover={motionWhileHover}
      transition={SPRING_SMOOTH_TWO}
    >
      {fullAddress ? (
        <Link
          to="/portraits/$agentId"
          params={{ agentId: fullAddress }}
          className="block"
        >
          {card}
        </Link>
      ) : (
        card
      )}
    </motion.div>
  )
}
