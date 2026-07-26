import { useScrollBatchReveal } from '@/hooks/useScrollBatchReveal'

const CATEGORIES = [
  {
    name: 'Memory core',
    tools: [
      'memory_write',
      'memory_query',
      'memory_bulk_write',
      'memory_list',
      'memory_get',
      'memory_delete',
      'memory_session_context',
      'memory_consolidate',
      'memory_diff',
      'memory_pin',
      'memory_related',
      'memory_template',
    ],
  },
  {
    name: 'Identity & reputation',
    tools: [
      'identity_stats',
      'memory_whoami',
      'memory_reputation_lookup',
      'memory_verify_attestation',
    ],
  },
  {
    name: 'Portrait & provenance',
    tools: [
      'portrait_get',
      'seal_generate',
      'memory_share',
      'memory_portability_pack',
    ],
  },
  {
    name: 'Vertical copilots',
    tools: [
      'finance_brief',
      'lifestyle_remember',
      'daily_brief',
      'memory_goal_set',
      'memory_habit_check',
      'portfolio_snapshot',
      'memory_analytics',
      'memory_graph',
    ],
  },
  {
    name: 'Onboarding & ops',
    tools: [
      'memory_demo_pack',
      'memory_seed_wallet',
      'amber_onboarding',
      'amber_judging_pack',
      'amber_live_stats',
    ],
  },
] as const

export default function McpToolsGrid() {
  const gridRef = useScrollBatchReveal<HTMLDivElement>()
  const total = CATEGORIES.reduce((sum, c) => sum + c.tools.length, 0)

  return (
    <div>
      <p className="font-mono text-[0.6875rem] tracking-[0.02em] text-fg-faint">
        {total} MCP tools · protocol 2025-06-18
      </p>
      <div ref={gridRef} className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {CATEGORIES.map((category) => (
          <div
            key={category.name}
            className="reveal-item rounded-lg border border-line bg-surface p-6"
          >
            <h3 className="text-sm font-medium text-fg">{category.name}</h3>
            <p className="mt-1 font-mono text-[0.6875rem] text-fg-faint">
              {category.tools.length} tools
            </p>
            <ul className="mt-4 flex flex-col gap-2">
              {category.tools.map((tool) => (
                <li
                  key={tool}
                  className="font-mono text-[0.8125rem] text-fg-muted"
                >
                  {tool}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
