import { useState } from 'react'
import { config } from '@/config'
import {
  isValidIdentity,
  listMemories,
  writeMemory,
  type ListedMemory,
} from '@/lib/amber-api'
import { cnm } from '@/utils/style'

const DEMO_IDENTITY = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'

export default function MemoryDemo() {
  const [identity, setIdentity] = useState(DEMO_IDENTITY)
  const [content, setContent] = useState(
    'Remember: prefer pgvector with cosine similarity for recall.',
  )
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [freeRemaining, setFreeRemaining] = useState<number | null>(null)
  const [memories, setMemories] = useState<ListedMemory[]>([])
  const [lastMemoryId, setLastMemoryId] = useState<string | null>(null)

  const runWrite = async () => {
    if (!isValidIdentity(identity)) {
      setStatus('Identity must be a 0x + 40 hex address.')
      return
    }
    if (!content.trim()) {
      setStatus('Write something to remember.')
      return
    }

    setBusy(true)
    setStatus(null)
    try {
      const res = await writeMemory({
        identity: identity.toLowerCase(),
        content: content.trim(),
        category: 'note',
        tags: ['demo'],
        clientNonce: `amber-web-${Date.now()}`,
      })

      if (!res.success || !res.data) {
        setStatus(res.error?.message ?? 'Write failed')
        return
      }

      setLastMemoryId(res.data.memoryId)
      setFreeRemaining(res.data.quota.freeRemaining)
      setStatus(
        `Preserved. Attestation ${res.data.attestation.status}. Free writes left: ${res.data.quota.freeRemaining}.`,
      )

      const listed = await listMemories({
        identity: identity.toLowerCase(),
        limit: 5,
      })
      if (listed.success && listed.data) {
        setMemories(listed.data.memories)
      }
    } catch (err) {
      setStatus(
        err instanceof Error
          ? `Backend unreachable: ${err.message}. Is ${config.api.baseUrl} running?`
          : 'Backend unreachable',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="space-y-6">
        <label className="block space-y-2">
          <span className="text-sm tracking-wide text-[var(--amber-cream)]/60">
            ERC-8004 identity
          </span>
          <input
            value={identity}
            onChange={(e) => setIdentity(e.target.value)}
            spellCheck={false}
            className={cnm(
              'w-full rounded-none border border-[var(--amber-cream)]/15 bg-black/40',
              'px-4 py-3 font-mono text-sm text-[var(--amber-cream)]',
              'outline-none focus:border-[var(--amber-baltic)]',
            )}
          />
        </label>

        <label className="block space-y-2">
          <span className="text-sm tracking-wide text-[var(--amber-cream)]/60">
            Memory to preserve
          </span>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
            maxLength={8192}
            className={cnm(
              'w-full resize-y rounded-none border border-[var(--amber-cream)]/15 bg-black/40',
              'px-4 py-3 text-[var(--amber-cream)]',
              'outline-none focus:border-[var(--amber-baltic)]',
            )}
          />
        </label>

        <button
          type="button"
          disabled={busy}
          onClick={() => void runWrite()}
          className={cnm(
            'inline-flex items-center justify-center px-6 py-3',
            'bg-[var(--amber-baltic)] text-[var(--amber-ink)] font-medium tracking-wide',
            'transition-opacity hover:opacity-90 disabled:opacity-50',
          )}
        >
          {busy
            ? 'Preserving…'
            : `Write memory (first ${config.pricing.freeWrites} free)`}
        </button>

        {status && (
          <p className="text-sm text-[var(--amber-baltic)] font-mono leading-relaxed">
            {status}
          </p>
        )}

        {(lastMemoryId || freeRemaining !== null) && (
          <p className="text-xs text-[var(--amber-cream)]/45 font-mono">
            {lastMemoryId ? `memoryId ${lastMemoryId}` : null}
            {freeRemaining !== null
              ? ` · freeRemaining ${freeRemaining}`
              : null}
          </p>
        )}

        {memories.length > 0 && (
          <ul className="space-y-3 border-t border-[var(--amber-cream)]/10 pt-6">
            {memories.map((m) => (
              <li
                key={m.memoryId}
                className="border-l-2 border-[var(--amber-baltic)]/50 pl-4 py-1"
              >
                <p className="text-[var(--amber-cream)] text-sm leading-relaxed">
                  {m.content}
                </p>
                <p className="mt-1 text-xs font-mono text-[var(--amber-cream)]/40">
                  {m.category} · {m.attestation.status} ·{' '}
                  {new Date(m.createdAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
