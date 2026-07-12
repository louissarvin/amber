import axios, { AxiosError } from 'axios';
import crypto from 'node:crypto';
import { ethers } from 'ethers';
import { xlayerProvider } from './rpc.ts';
import {
  ASP_PRIVATE_KEY,
  ATTESTATION_CONTRACT_ADDRESS,
  OKX_API_KEY,
  OKX_PASSPHRASE,
  OKX_SECRET_KEY,
  OKX_WALLET_ADDRESS,
  SIGNER_MODE,
  XLAYER_CHAIN_ID,
} from '../../config/main-config.ts';

// -----------------------------------------------------------------------------
// Attestation contract wrapper + signer dispatcher
//
// ABI (locked in docs/05_ATTESTATION_WORKER.md):
//   event Attestation(bytes32 indexed merkleRoot, address indexed identity, uint256 timestamp);
//   function attest(bytes32 merkleRoot, address identity, uint256 timestamp) external;
//
// Two signer paths per ADR-009:
//   - TEE: OKX Agentic Wallet API-key signed sendTransaction
//   - Self: ethers.Wallet with ASP_PRIVATE_KEY
//
// Try-TEE-fall-back-to-self is the default when SIGNER_MODE=tee.
// -----------------------------------------------------------------------------

export const ATTESTATION_ABI = [
  'event Attestation(bytes32 indexed merkleRoot, address indexed identity, uint256 timestamp)',
  'function attest(bytes32 merkleRoot, address identity, uint256 timestamp) external',
];

const attestationInterface = new ethers.Interface(ATTESTATION_ABI);

export interface SendResult {
  txHash: string;
  signerAddress: string;
  mode: 'tee' | 'self';
}

const buildAttestData = (root: Buffer, identity: string, timestampUnix: number): string => {
  const rootHex = `0x${root.toString('hex')}`;
  return attestationInterface.encodeFunctionData('attest', [
    rootHex,
    ethers.getAddress(identity),
    BigInt(timestampUnix),
  ]);
};

// -----------------------------------------------------------------------------
// Self-custody signer
// -----------------------------------------------------------------------------

let selfWallet: ethers.Wallet | null = null;
const selfWalletOrThrow = (): ethers.Wallet => {
  if (selfWallet) return selfWallet;
  if (!ASP_PRIVATE_KEY) {
    throw new Error('SIGNER_MODE self requested but ASP_PRIVATE_KEY not configured');
  }
  selfWallet = new ethers.Wallet(ASP_PRIVATE_KEY, xlayerProvider());
  return selfWallet;
};

// Error class used when a tx was broadcast successfully but confirmation
// wait timed out. Callers should persist `txHash` on the failed row so a
// later retry can look up the receipt on-chain before re-broadcasting.
export class BroadcastPendingError extends Error {
  txHash: string;
  cause?: Error;
  constructor(txHash: string, cause?: Error) {
    super(`tx ${txHash} broadcast but confirmation timed out${cause ? `: ${cause.message}` : ''}`);
    this.name = 'BroadcastPendingError';
    this.txHash = txHash;
    if (cause) this.cause = cause;
  }
}

const sendViaSelf = async (data: string): Promise<SendResult> => {
  const wallet = selfWalletOrThrow();
  const tx = await wallet.sendTransaction({
    to: ATTESTATION_CONTRACT_ADDRESS,
    data,
    chainId: XLAYER_CHAIN_ID,
  });
  try {
    await tx.wait(1);
  } catch (err) {
    // Broadcast succeeded (we have tx.hash) but confirmation failed. Signal
    // this specifically so the caller can persist lastTxHash.
    throw new BroadcastPendingError(tx.hash, err as Error);
  }
  return {
    txHash: tx.hash,
    signerAddress: wallet.address.toLowerCase(),
    mode: 'self',
  };
};

// -----------------------------------------------------------------------------
// TEE (OKX Agentic Wallet) signer
//
// Reference: docs.okx.com — Agent Wallet API `sendTransaction` endpoint.
// Signing scheme: OK-ACCESS-SIGN = base64(HMAC_SHA256(secret,
//   timestamp + method + requestPath + body)).
//
// If OKX changes the wire shape, only decodeReply-style patching is required
// — the fallback path keeps the demo alive.
// -----------------------------------------------------------------------------

const OKX_BASE = 'https://web3.okx.com';
const OKX_SEND_TX_PATH = '/api/v5/wallet/pre-transaction/broadcast-transaction';

const okxSignRequest = (
  timestamp: string,
  method: string,
  requestPath: string,
  body: string
): string => {
  if (!OKX_SECRET_KEY) throw new Error('OKX_SECRET_KEY missing');
  const msg = `${timestamp}${method}${requestPath}${body}`;
  return crypto.createHmac('sha256', OKX_SECRET_KEY).update(msg).digest('base64');
};

const sendViaTee = async (data: string): Promise<SendResult> => {
  if (!OKX_API_KEY || !OKX_SECRET_KEY || !OKX_PASSPHRASE || !OKX_WALLET_ADDRESS) {
    throw new Error('SIGNER_MODE tee requested but OKX_* env vars incomplete');
  }
  const body = JSON.stringify({
    chainIndex: String(XLAYER_CHAIN_ID),
    fromAddr: OKX_WALLET_ADDRESS,
    signedTx: undefined, // undefined so we hand the raw call over for TEE signing
    txData: {
      to: ATTESTATION_CONTRACT_ADDRESS,
      data,
      chainId: String(XLAYER_CHAIN_ID),
      value: '0',
    },
  });
  const timestamp = new Date().toISOString();

  try {
    const res = await axios.post(`${OKX_BASE}${OKX_SEND_TX_PATH}`, JSON.parse(body), {
      timeout: 20_000,
      headers: {
        'OK-ACCESS-KEY': OKX_API_KEY,
        'OK-ACCESS-SIGN': okxSignRequest(timestamp, 'POST', OKX_SEND_TX_PATH, body),
        'OK-ACCESS-TIMESTAMP': timestamp,
        'OK-ACCESS-PASSPHRASE': OKX_PASSPHRASE,
        'Content-Type': 'application/json',
      },
    });
    const payload = res.data as {
      code?: string;
      data?: Array<{ txHash?: string; orderId?: string }>;
    };
    const txHash = payload?.data?.[0]?.txHash ?? payload?.data?.[0]?.orderId;
    if (!txHash) throw new Error(`OKX response missing txHash: ${JSON.stringify(payload).slice(0, 200)}`);
    return {
      txHash,
      signerAddress: OKX_WALLET_ADDRESS,
      mode: 'tee',
    };
  } catch (err) {
    const ax = err as AxiosError;
    const detail = ax.response
      ? `${ax.response.status} ${JSON.stringify(ax.response.data).slice(0, 200)}`
      : ax.message;
    throw new Error(`OKX TEE send failed: ${detail}`);
  }
};

// -----------------------------------------------------------------------------
// Dispatcher
// -----------------------------------------------------------------------------

export const sendAttestation = async (
  root: Buffer,
  identity: string,
  timestampUnix: number
): Promise<SendResult> => {
  const data = buildAttestData(root, identity, timestampUnix);

  if (SIGNER_MODE === 'tee') {
    try {
      return await sendViaTee(data);
    } catch (err) {
      if (!ASP_PRIVATE_KEY) throw err;
      console.warn(
        '[attestation] TEE signer failed, falling back to self-custody:',
        (err as Error).message
      );
      return await sendViaSelf(data);
    }
  }

  return await sendViaSelf(data);
};

export const signerAddressForMode = (): string | null => {
  if (SIGNER_MODE === 'tee') return OKX_WALLET_ADDRESS ?? null;
  try {
    return selfWalletOrThrow().address.toLowerCase();
  } catch {
    return null;
  }
};
