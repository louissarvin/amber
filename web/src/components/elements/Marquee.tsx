import { cnm } from '@/utils/style'

interface MarqueeProps {
  items: Array<string>
  className?: string
}

function Track({ items, hidden }: { items: Array<string>; hidden: boolean }) {
  return (
    <div
      className="flex shrink-0 items-center gap-8 pr-8"
      aria-hidden={hidden || undefined}
    >
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-8">
          <span className="font-mono text-[0.8125rem] whitespace-nowrap text-fg-subtle">
            {item}
          </span>
          <span className="text-primary/40" aria-hidden="true">
            &middot;
          </span>
        </span>
      ))}
    </div>
  )
}

/**
 * Pure CSS infinite marquee — no JS, no layout thrash.
 * Content is duplicated once so the -50% translate loops seamlessly.
 * Respects prefers-reduced-motion via .animate-marquee (see styles.css).
 */
export default function Marquee({ items, className }: MarqueeProps) {
  return (
    <div className={cnm('overflow-hidden', className)}>
      <div className="animate-marquee flex w-max">
        <Track items={items} hidden={false} />
        <Track items={items} hidden />
      </div>
    </div>
  )
}
