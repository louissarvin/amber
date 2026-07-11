import { keccak_256 } from '@noble/hashes/sha3';
import { concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

// -----------------------------------------------------------------------------
// keccak256 Merkle tree over up to 32 leaves.
//
// Leaf hashing (matches `docs/05_ATTESTATION_WORKER.md`):
//   keccak256(abi.encodePacked(
//     identity(20), memoryId(bytes), contentHash(32), category(bytes), uint256(createdAt)))
//
// Root hashing (OpenZeppelin MerkleProof-compatible):
//   pair = sorted(left, right); parent = keccak256(pair)
//   odd sibling is duplicated.
//   Batches are padded to 32 leaves with keccak256(0x00 * 32) so proofs against
//   the deployed verifier are stable.
// -----------------------------------------------------------------------------

const MAX_LEAVES = 32;
const ZERO_LEAF = Buffer.alloc(32, 0); // bytes32(0)

export interface PendingAttestation {
  memoryId: string;
  identityAddress: string; // lowercased 0x...
  contentHash: string; // 0x-prefixed hex, 64 chars
  category: string;
  createdAtUnix: number;
}

export const leafHash = (item: PendingAttestation): Buffer => {
  const identityBytes = hexToBytes(item.identityAddress.replace(/^0x/, ''));
  if (identityBytes.length !== 20) {
    throw new Error(`leafHash: identity must be 20 bytes, got ${identityBytes.length}`);
  }
  const memoryIdBytes = utf8ToBytes(item.memoryId);
  const contentHashBytes = hexToBytes(item.contentHash.replace(/^0x/, ''));
  if (contentHashBytes.length !== 32) {
    throw new Error(
      `leafHash: contentHash must be 32 bytes, got ${contentHashBytes.length}`
    );
  }
  const categoryBytes = utf8ToBytes(item.category);
  const tsBuf = Buffer.alloc(32);
  // uint256 big-endian, low 8 bytes carry the unix seconds.
  tsBuf.writeBigUInt64BE(BigInt(item.createdAtUnix), 24);

  const packed = concatBytes(
    identityBytes,
    memoryIdBytes,
    contentHashBytes,
    categoryBytes,
    tsBuf
  );
  return Buffer.from(keccak_256(packed));
};

const hashPair = (a: Buffer, b: Buffer): Buffer => {
  const sorted = Buffer.compare(a, b) <= 0 ? Buffer.concat([a, b]) : Buffer.concat([b, a]);
  return Buffer.from(keccak_256(sorted));
};

export const merkleRoot = (leaves: Buffer[]): Buffer => {
  if (leaves.length === 0) throw new Error('merkleRoot: empty leaves');
  if (leaves.length > MAX_LEAVES) {
    throw new Error(`merkleRoot: too many leaves (${leaves.length} > ${MAX_LEAVES})`);
  }

  // Pad to a power of two up to MAX_LEAVES to keep root shape stable.
  const padded = leaves.slice();
  while (padded.length < MAX_LEAVES) padded.push(ZERO_LEAF);

  let layer = padded;
  while (layer.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      next.push(hashPair(layer[i], layer[i + 1] ?? layer[i]));
    }
    layer = next;
  }
  return layer[0];
};

export const MAX_BATCH_LEAVES = MAX_LEAVES;

// -----------------------------------------------------------------------------
// Merkle proof — sibling hashes bottom-up. Compatible with OpenZeppelin's
// MerkleProof.processProof (sorted pairs). Consumers should submit
// `{ leaf, proof }` to the on-chain verifier along with the root.
// -----------------------------------------------------------------------------
export interface MerkleProof {
  leaf: string; // 0x + 64 hex
  leafIndex: number;
  proof: string[]; // 0x + 64 hex, ordered bottom → top
  root: string; // 0x + 64 hex
}

export const merkleProof = (leaves: Buffer[], leafIndex: number): MerkleProof => {
  if (leaves.length === 0) throw new Error('merkleProof: empty leaves');
  if (leaves.length > MAX_LEAVES) {
    throw new Error(`merkleProof: too many leaves (${leaves.length} > ${MAX_LEAVES})`);
  }
  if (leafIndex < 0 || leafIndex >= leaves.length) {
    throw new Error(`merkleProof: leafIndex ${leafIndex} out of range`);
  }

  const padded = leaves.slice();
  while (padded.length < MAX_LEAVES) padded.push(ZERO_LEAF);

  const proof: string[] = [];
  let idx = leafIndex;
  let layer = padded;
  while (layer.length > 1) {
    const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
    const sibling = layer[siblingIdx] ?? layer[idx];
    proof.push(`0x${sibling.toString('hex')}`);
    const next: Buffer[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      next.push(hashPair(layer[i], layer[i + 1] ?? layer[i]));
    }
    layer = next;
    idx = Math.floor(idx / 2);
  }

  return {
    leaf: `0x${leaves[leafIndex].toString('hex')}`,
    leafIndex,
    proof,
    root: `0x${layer[0].toString('hex')}`,
  };
};
