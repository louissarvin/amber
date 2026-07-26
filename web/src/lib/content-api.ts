/**
 * Read-only fetchers for the content cluster routes (how-it-works, developers,
 * pricing, agents). Talks directly to the live AMBER backend — not the
 * dev-local `config.api.baseUrl` used by the memory demo — since this data
 * (comparables, public stats, vertical demos) is served from production and
 * is safe to read cross-origin (the API sends `Access-Control-Allow-Origin: *`).
 */
const CONTENT_API_BASE = 'https://amber-mcp.xyz'

export type AmberEnvelope<T> = {
  success: boolean
  error: { code: string; message: string } | null
  data: T | null
}

export type ComparablesCapability = {
  capability: string
  mem0: boolean | string
  zep: boolean | string
  letta: boolean | string
  amber: string
}

export type Comparables = {
  schema: string
  title: string
  thesis: string
  amberScope: string
  matrix: { capabilities: Array<ComparablesCapability> }
  verdict: string
  generatedAt: string
}

export type PublicStats = {
  amber: { chainId: number; network: string; chain: string }
  revenue: {
    payments_count: number
    unique_payers: number
    usdt_volume: string
    last_payment: string | null
  }
  usage: { identities: number; active_memories: number }
  generatedAt: string
}

export type VerticalKey =
  | 'professional_asset'
  | 'resume'
  | 'creative'
  | 'software'
  | 'prediction'

export type VerticalDemo = {
  title: string
  vertical: VerticalKey
  chain: { id: number; name: string }
  sampleMemory: {
    subject: string
    content: string
    category: string
    tags: Array<string>
  }
  recommendedTools: Array<string>
  templateCall: string
  followUpCall: string
  useCase: string
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${CONTENT_API_BASE}${path}`)
  const json = (await res.json()) as AmberEnvelope<T>
  if (!json.success || !json.data) {
    throw new Error(json.error?.message ?? `Request to ${path} failed`)
  }
  return json.data
}

export function fetchComparables(): Promise<Comparables> {
  return getJson<Comparables>('/report/comparables')
}

/** Unlike the other content endpoints, `/public/stats` returns its payload
 * flat — no `{success,error,data}` envelope — so it can't go through
 * `getJson`. */
export async function fetchPublicStats(): Promise<PublicStats> {
  const res = await fetch(`${CONTENT_API_BASE}/public/stats`)
  if (!res.ok) {
    throw new Error(`Request to /public/stats failed (${res.status})`)
  }
  return (await res.json()) as PublicStats
}

export function fetchVerticalDemo(vertical: VerticalKey): Promise<VerticalDemo> {
  return getJson<VerticalDemo>(`/demo/live/${vertical}`)
}
