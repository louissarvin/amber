import { isValidIdentity } from '@/lib/amber-api'

/**
 * Reputation cluster fetchers. Talks directly to the live amber-mcp.xyz API
 * (CORS is open `*`) rather than the local dev API used by `amber-api.ts`,
 * since the reputation/leaderboard data only exists on the production
 * service.
 */
const REPUTATION_API_BASE = 'https://amber-mcp.xyz'

/** The one identity known to have a full, unanonymized address. */
export const DEMO_AGENT_ADDRESS = '0xdeadbeef000000000000000000000000deadbeef'

interface Envelope<T> {
  success: boolean
  error: { code: string; message: string } | null
  data: T | null
}

export interface LeaderboardEntry {
  rank: number
  /** Anonymized: first 2 + last 4 hex chars, e.g. "0xde...beef". */
  identity: string
  memoryCount: number
  categories: Array<string>
}

export interface LeaderboardResponse {
  leaderboard: Array<LeaderboardEntry>
  note: string
  generatedAt: string
}

interface ReputationAxisBase {
  points: number
  note: string
}

export interface ReputationBreakdown {
  persistence: ReputationAxisBase & { memories: number }
  verification: ReputationAxisBase & { attestedRatio: string }
  economic: ReputationAxisBase & { paidWrites: string; sealCount: number }
  breadth: ReputationAxisBase & { verticalsUsed: Array<string> }
  deliberateness: ReputationAxisBase & { pinnedCount: number }
  longevity: ReputationAxisBase & { daysActive: number }
}

/**
 * Shape varies by tier: "unseen" identities (score 0) come back without a
 * `breakdown`, `totalMemories`, or timestamps — every field below except
 * the core identity/score/tier trio is therefore optional.
 */
export interface ReputationData {
  address: string
  erc8004AgentId?: string | null
  score: number
  tier: string
  tierIcon: string
  breakdown?: ReputationBreakdown
  totalMemories?: number
  firstSeenAt?: string | null
  lastActiveAt?: string | null
  attestationRate?: string
  summary: string
  note?: string
  links?: {
    portrait?: string
    analytics?: string
    stats?: string
    manifest?: string
    docs?: string
    onboarding?: string
  }
  generatedAt: string
}

export interface CategoryCount {
  category: string
  count: number
}

export interface DailyCount {
  day: string
  count: number
}

export interface TagCount {
  tag: string
  count: number
}

export interface AnalyticsData {
  address: string
  totalMemories: number
  categoryBreakdown: Array<CategoryCount>
  dailyTimeline: Array<DailyCount>
  topTags: Array<TagCount>
  attestedCount: number
  pendingAttestation: number
  sealCount: number
  sharedIn: number
  sharedOut: number
  portraitUrl: string
  generatedAt: string
}

async function unwrap<T>(res: Response): Promise<T> {
  const json = (await res.json()) as Envelope<T>
  if (!json.success || json.data === null) {
    throw new Error(json.error?.message ?? 'Request failed')
  }
  return json.data
}

export async function fetchLeaderboard(): Promise<LeaderboardResponse> {
  const res = await fetch(`${REPUTATION_API_BASE}/public/leaderboard`)
  if (!res.ok) throw new Error(`Leaderboard request failed (${res.status})`)
  return (await res.json()) as LeaderboardResponse
}

export async function fetchReputation(
  address: string,
): Promise<ReputationData> {
  if (!isValidIdentity(address)) {
    throw new Error('Invalid identity address')
  }
  const res = await fetch(
    `${REPUTATION_API_BASE}/identity/reputation/${encodeURIComponent(address)}`,
  )
  return unwrap<ReputationData>(res)
}

export async function fetchAnalytics(address: string): Promise<AnalyticsData> {
  if (!isValidIdentity(address)) {
    throw new Error('Invalid identity address')
  }
  const res = await fetch(
    `${REPUTATION_API_BASE}/analytics/${encodeURIComponent(address)}`,
  )
  return unwrap<AnalyticsData>(res)
}

/** Truncate a full address for compact display: 0xdeadbe...beef */
export function truncateAddress(address: string, front = 6, back = 4): string {
  if (address.length <= front + back + 2) return address
  return `${address.slice(0, front)}...${address.slice(-back)}`
}

/** Matches the leaderboard's own truncation: 0x + first 2 hex + ... + last 4 hex. */
function apiStyleTruncate(address: string): string {
  const hex = address.slice(2).toLowerCase()
  return `0x${hex.slice(0, 2)}...${hex.slice(-4)}`
}

/**
 * The public leaderboard only exposes anonymized identities. We never
 * fabricate a full address — only the known demo identity can be resolved
 * back to its full form for deep-linking into `/reputation/$agentId`.
 */
export function resolveLeaderboardAddress(
  truncatedIdentity: string,
): string | null {
  return apiStyleTruncate(DEMO_AGENT_ADDRESS) === truncatedIdentity.toLowerCase()
    ? DEMO_AGENT_ADDRESS
    : null
}

export interface RadarAxisDatum {
  key: string
  label: string
  value: number
  colorVar: string
}

/**
 * Maps the API's 6 real axes onto the design system's warm-to-cool axis hue
 * tokens (DESIGN.md §2.5 — the token names are a color proposal, not a
 * naming requirement). Points are normalized to 0-100 against each axis's
 * own cap so the radar reads as relative performance, not raw point counts.
 */
export const AXIS_META: Array<{
  key: keyof ReputationBreakdown
  label: string
  colorVar: string
  max: number
}> = [
  {
    key: 'persistence',
    label: 'Persistence',
    colorVar: '--color-axis-persistence',
    max: 25,
  },
  {
    key: 'verification',
    label: 'Verification',
    colorVar: '--color-axis-verification',
    max: 25,
  },
  {
    key: 'economic',
    label: 'Economic',
    colorVar: '--color-axis-economic',
    max: 20,
  },
  {
    key: 'breadth',
    label: 'Breadth',
    colorVar: '--color-axis-breadth',
    max: 15,
  },
  {
    key: 'deliberateness',
    label: 'Deliberateness',
    colorVar: '--color-axis-deliberateness',
    max: 10,
  },
  {
    key: 'longevity',
    label: 'Longevity',
    colorVar: '--color-axis-longevity',
    max: 5,
  },
]

export function buildRadarAxes(data: ReputationData): Array<RadarAxisDatum> {
  if (!data.breakdown) return []
  const breakdown = data.breakdown
  return AXIS_META.map((meta) => {
    const axis = breakdown[meta.key]
    const value = Math.max(0, Math.min(100, (axis.points / meta.max) * 100))
    return { key: meta.key, label: meta.label, value, colorVar: meta.colorVar }
  })
}
