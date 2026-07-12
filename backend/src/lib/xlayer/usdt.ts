import { ethers, verifyTypedData } from 'ethers';
import { xlayerProvider } from './rpc.ts';
import {
  ASP_PRIVATE_KEY,
  USDT_EIP712_NAME,
  USDT_EIP712_VERSION,
  USDT_XLAYER_ADDRESS,
  XLAYER_CHAIN_ID,
} from '../../config/main-config.ts';

// -----------------------------------------------------------------------------
// USDT (XLayer) EIP-712 domain + EIP-3009 signature verification
//
// On startup we read `name()` and `version()` from the deployed contract and
// cache them. If those reads fail we REFUSE to start — verifying a signature
// against the wrong domain is a silent-fail bug that lets attackers replay
// signed authorizations from another chain / contract.
//
// The verified values are cached in-process. Env fallbacks are only used
// as an override for local dev (USDT_EIP712_NAME / USDT_EIP712_VERSION).
// -----------------------------------------------------------------------------

const USDT_META_ABI = [
  'function name() external view returns (string)',
  'function version() external view returns (string)',
];

export interface UsdtDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

let cachedDomain: UsdtDomain | null = null;

export const initUsdtDomain = async (): Promise<UsdtDomain> => {
  if (cachedDomain) return cachedDomain;

  const contract = new ethers.Contract(USDT_XLAYER_ADDRESS, USDT_META_ABI, xlayerProvider());

  let name: string;
  let version: string;
  try {
    // `name()` is standard ERC-20. `version()` is EIP-3009 / EIP-2612.
    name = (await contract.name()) as string;
  } catch (err) {
    throw new Error(
      `USDT.name() read failed on XLayer: ${(err as Error).message}. Refusing to start.`
    );
  }

  try {
    version = (await contract.version()) as string;
  } catch (err) {
    // Some USDT deployments do not expose version() — fall back to env config.
    console.warn(
      `[usdt] version() read failed; falling back to USDT_EIP712_VERSION=${USDT_EIP712_VERSION}: ${(err as Error).message}`
    );
    version = USDT_EIP712_VERSION;
  }

  if (USDT_EIP712_NAME && USDT_EIP712_NAME !== name) {
    console.warn(
      `[usdt] on-chain name (${name}) does not match USDT_EIP712_NAME env (${USDT_EIP712_NAME}). Using on-chain value.`
    );
  }
  if (USDT_EIP712_VERSION && USDT_EIP712_VERSION !== version) {
    console.warn(
      `[usdt] on-chain version (${version}) does not match USDT_EIP712_VERSION env (${USDT_EIP712_VERSION}). Using on-chain value.`
    );
  }

  cachedDomain = {
    name,
    version,
    chainId: XLAYER_CHAIN_ID,
    verifyingContract: USDT_XLAYER_ADDRESS,
  };
  console.log(
    `[usdt] EIP-712 domain locked: name="${name}" version="${version}" chainId=${XLAYER_CHAIN_ID} verifyingContract=${USDT_XLAYER_ADDRESS}`
  );
  return cachedDomain;
};

export const getUsdtDomain = (): UsdtDomain => {
  if (!cachedDomain) {
    throw new Error('USDT domain not initialised — call initUsdtDomain() before verifying.');
  }
  return cachedDomain;
};

export interface Eip3009Authorization {
  from: string;
  to: string;
  value: string | number | bigint;
  validAfter: string | number | bigint;
  validBefore: string | number | bigint;
  nonce: string; // 0x-prefixed 32-byte hex
}

const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

/**
 * Verify an EIP-3009 transferWithAuthorization signature.
 * Returns the recovered signer address (lowercased) or throws.
 */
export const verifyEip3009 = (
  auth: Eip3009Authorization,
  signature: string
): string => {
  const domain = getUsdtDomain();
  const recovered = verifyTypedData(domain, EIP3009_TYPES, auth, signature);
  return recovered.toLowerCase();
};

const USDT_SETTLE_ABI = [
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external',
];

export interface SettleAuthInput {
  from: string;
  to: string;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: string; // 0x + 64 hex
  signature: string; // 65-byte hex sig
}

/**
 * Redeem a stored EIP-3009 authorization on-chain via the ASP hot wallet.
 * Requires ASP_PRIVATE_KEY. Returns the settlement tx hash.
 */
export const settleTransferWithAuthorization = async (
  input: SettleAuthInput
): Promise<string> => {
  if (!ASP_PRIVATE_KEY) {
    throw new Error('ASP_PRIVATE_KEY required to settle payments on-chain');
  }

  const wallet = new ethers.Wallet(ASP_PRIVATE_KEY, xlayerProvider());
  const usdt = new ethers.Contract(USDT_XLAYER_ADDRESS, USDT_SETTLE_ABI, wallet);

  const sig = ethers.Signature.from(input.signature);
  const tx = await usdt.transferWithAuthorization(
    input.from,
    input.to,
    input.value,
    input.validAfter,
    input.validBefore,
    input.nonce,
    sig.v,
    sig.r,
    sig.s
  );
  const receipt = await tx.wait(1);
  if (!receipt?.hash) {
    throw new Error('settle tx mined without hash');
  }
  return receipt.hash as string;
};
