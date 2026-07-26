import { queryOptions } from '@tanstack/react-query'

/**
 * Public, unauthenticated AMBER endpoints — leaderboard, portraits,
 * analytics, and the whoami dossier. Always live at amber-mcp.xyz
 * regardless of environment (distinct from the write/list API in
 * `@/lib/amber-api.ts`, which targets `config.api.baseUrl`).
 */
const AMBER_PUBLIC_API = 'https://amber-mcp.xyz'

export interface ApiEnvelope<T> {
  success: boolean
  error: { code: string; message: string } | null
  data: T | null
}

export interface LeaderboardEntry {
  rank: number
  identity: string
  memoryCount: number
  categories: Array<string>
}

export interface LeaderboardResponse {
  leaderboard: Array<LeaderboardEntry>
  note?: string
  generatedAt?: string
}

export interface CategoryBreakdownEntry {
  category: string
  count: number
}

export interface DailyTimelineEntry {
  day: string
  count: number
}

export interface TopTagEntry {
  tag: string
  count: number
}

export interface AnalyticsData {
  address: string
  totalMemories: number
  categoryBreakdown: Array<CategoryBreakdownEntry>
  dailyTimeline: Array<DailyTimelineEntry>
  topTags: Array<TopTagEntry>
  attestedCount: number
  pendingAttestation: number
  portraitUrl: string
  generatedAt: string
}

export interface WhoamiData {
  identity: string
  summary: string
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Request to ${url} failed with ${res.status}`)
  }
  return (await res.json()) as T
}

async function fetchEnvelope<T>(url: string): Promise<T> {
  const envelope = await fetchJson<ApiEnvelope<T>>(url)
  if (!envelope.success || !envelope.data) {
    throw new Error(envelope.error?.message ?? 'Request failed')
  }
  return envelope.data
}

export async function getLeaderboard(): Promise<LeaderboardResponse> {
  return fetchJson<LeaderboardResponse>(`${AMBER_PUBLIC_API}/public/leaderboard`)
}

export async function getAnalytics(address: string): Promise<AnalyticsData> {
  const url = `${AMBER_PUBLIC_API}/analytics/${encodeURIComponent(address)}`
  return fetchEnvelope<AnalyticsData>(url)
}

export async function getWhoami(address: string): Promise<WhoamiData> {
  const url = new URL(`${AMBER_PUBLIC_API}/memory/whoami`)
  url.searchParams.set('identity', address)
  return fetchEnvelope<WhoamiData>(url.toString())
}

/** Builds the constellation SVG URL for an identity. Safe to call with a
 * truncated leaderboard identity too — the request will 400/404 and the
 * caller's `<img onError>` handles the graceful fallback. */
export function portraitSvgUrl(identity: string): string {
  return `${AMBER_PUBLIC_API}/portrait/${encodeURIComponent(identity)}.svg`
}

export function portraitCardUrl(address: string): string {
  return `${AMBER_PUBLIC_API}/portrait/${encodeURIComponent(address)}/card.png`
}

const FULL_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const TRUNCATED_RE = /^0x([0-9a-fA-F]{2})\.\.\.([0-9a-fA-F]{4})$/

export function isFullAddress(identity: string): boolean {
  return FULL_ADDRESS_RE.test(identity)
}

/** The one identity with a known full address — used as the flagship
 * demo portrait. Every other leaderboard row is anonymized server-side
 * (first 2 + last 4 hex chars), so we never invent addresses for them. */
export const FLAGSHIP_ADDRESS = '0xdeadbeef000000000000000000000000deadbeef'

const KNOWN_FULL_ADDRESSES = [FLAGSHIP_ADDRESS]

function truncatedMatchesFull(truncated: string, full: string): boolean {
  const match = TRUNCATED_RE.exec(truncated)
  if (!match) return false
  const [, prefix, suffix] = match
  const fullLower = full.toLowerCase()
  return (
    fullLower.startsWith(`0x${prefix.toLowerCase()}`) &&
    fullLower.endsWith(suffix.toLowerCase())
  )
}

/** Resolves a leaderboard identity to a full address safe to deep-link to.
 * Returns null rather than guessing when we don't independently know the
 * full address behind a truncated one. */
export function resolveFullAddress(identity: string): string | null {
  if (isFullAddress(identity)) return identity
  return (
    KNOWN_FULL_ADDRESSES.find((full) => truncatedMatchesFull(identity, full)) ??
    null
  )
}

export const leaderboardQueryOptions = () =>
  queryOptions({
    queryKey: ['portraits', 'leaderboard'] as const,
    queryFn: getLeaderboard,
    staleTime: 60_000,
  })

export const analyticsQueryOptions = (address: string) =>
  queryOptions({
    queryKey: ['portraits', 'analytics', address] as const,
    queryFn: () => getAnalytics(address),
    enabled: isFullAddress(address),
    staleTime: 60_000,
  })

export const whoamiQueryOptions = (address: string) =>
  queryOptions({
    queryKey: ['portraits', 'whoami', address] as const,
    queryFn: () => getWhoami(address),
    enabled: isFullAddress(address),
    staleTime: 60_000,
  })
