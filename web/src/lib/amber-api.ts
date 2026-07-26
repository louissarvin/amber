import { config } from '@/config'

export type AmberEnvelope<T> = {
  success: boolean
  error: { code: string; message: string } | null
  data: T | null
}

export type AttestationRef = {
  chainId: number
  txHash: string | null
  merkleRoot: string | null
  status: 'pending' | 'submitted' | 'attested' | 'failed'
  attestedAt: string | null
}

export type WriteResult = {
  memoryId: string
  createdAt: string
  attestation: AttestationRef
  quota: { freeRemaining: number }
}

export type ListedMemory = {
  memoryId: string
  content: string
  category: string
  tags: string[]
  createdAt: string
  attestation: AttestationRef
}

export type ListResult = {
  memories: ListedMemory[]
  nextCursor: string | null
  total: number
}

const base = () => config.api.baseUrl

async function parseJson<T>(res: Response): Promise<AmberEnvelope<T>> {
  const json = (await res.json()) as AmberEnvelope<T>
  return json
}

export async function healthz(): Promise<boolean> {
  try {
    const res = await fetch(`${base()}/healthz`)
    return res.ok
  } catch {
    return false
  }
}

export async function writeMemory(input: {
  identity: string
  content: string
  category?: string
  tags?: string[]
  clientNonce?: string
}): Promise<AmberEnvelope<WriteResult>> {
  const res = await fetch(`${base()}/memory/write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return parseJson<WriteResult>(res)
}

export async function listMemories(input: {
  identity: string
  limit?: number
}): Promise<AmberEnvelope<ListResult>> {
  const params = new URLSearchParams({
    identity: input.identity,
    limit: String(input.limit ?? 10),
  })
  const res = await fetch(`${base()}/memory/list?${params}`)
  return parseJson<ListResult>(res)
}

export function isValidIdentity(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address)
}
