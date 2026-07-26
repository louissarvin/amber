import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cnm } from '@/utils/style'

interface CodePanelProps {
  code: string
  className?: string
  label?: string
}

export default function CodePanel({ code, className, label }: CodePanelProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div
      className={cnm(
        'overflow-hidden rounded-md border border-line bg-surface-2',
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="font-mono text-[0.6875rem] tracking-[0.02em] text-fg-faint">
          {label ?? 'mcp'}
        </span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex items-center gap-1.5 text-fg-subtle transition-colors hover:text-primary"
          aria-label="Copy code"
        >
          {copied ? (
            <Check className="size-3.5 text-success" />
          ) : (
            <Copy className="size-3.5" />
          )}
          <span className="font-mono text-[0.6875rem]">
            {copied ? 'copied' : 'copy'}
          </span>
        </button>
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-[0.8125rem] leading-[1.5] text-fg-muted">
        <code>{code}</code>
      </pre>
    </div>
  )
}
