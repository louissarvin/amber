// Fetches token prices + wallet PnL from OKX Web3 DEX API.
// Used by WalletSeed v2 to bootstrap richer financial memories.
// Falls back gracefully when OKX_API_KEY is missing.
//
// Reference: https://web3.okx.com — DEX aggregator + Wallet asset endpoints.
// HMAC signing scheme mirrors the attestation.ts pattern (docs.okx.com auth).

import axios, { AxiosError } from 'axios';
import crypto from 'node:crypto';
import {
  OKX_API_KEY,
  OKX_PASSPHRASE,
  OKX_SECRET_KEY,
  XLAYER_CHAIN_ID,
} from '../../config/main-config.ts';

const OKX_BASE = 'https://web3.okx.com';
const REQUEST_TIMEOUT_MS = 8_000;

export interface TokenPrice {
  symbol: string;
  price: string;
  chainId: string;
}

export interface PortfolioToken {
  symbol: string;
  balance: string;
  usdValue: string;
}

export interface Portfolio {
  totalUsdValue: string;
  tokens: PortfolioToken[];
}

const EMPTY_PORTFOLIO: Portfolio = { totalUsdValue: '0', tokens: [] };

const hasOkxCreds = (): boolean =>
  Boolean(OKX_API_KEY && OKX_SECRET_KEY && OKX_PASSPHRASE);

// HMAC signature mirrors the existing attestation.ts scheme:
//   OK-ACCESS-SIGN = base64(HMAC_SHA256(secret, timestamp + method + path + body))
const sign = (
  timestamp: string,
  method: string,
  path: string,
  body: string = ''
): string => {
  if (!OKX_SECRET_KEY) throw new Error('OKX_SECRET_KEY missing');
  const msg = `${timestamp}${method}${path}${body}`;
  return crypto.createHmac('sha256', OKX_SECRET_KEY).update(msg).digest('base64');
};

const okxHeaders = (method: string, path: string, body: string = ''): Record<string, string> => {
  const timestamp = new Date().toISOString();
  return {
    'OK-ACCESS-KEY': OKX_API_KEY as string,
    'OK-ACCESS-SIGN': sign(timestamp, method, path, body),
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': OKX_PASSPHRASE as string,
    'Content-Type': 'application/json',
  };
};

const describeAxiosErr = (err: unknown): string => {
  const ax = err as AxiosError;
  if (ax.response) return `${ax.response.status} ${JSON.stringify(ax.response.data).slice(0, 200)}`;
  return ax.message ?? String(err);
};

// -----------------------------------------------------------------------------
// getOkxTokenPrices — enumerate all tokens on X Layer and filter by address.
// Endpoint: GET /api/v5/dex/aggregator/all-tokens?chainId=196
// Returns [] on any failure (missing creds, API down, malformed response).
// -----------------------------------------------------------------------------

export const getOkxTokenPrices = async (
  tokenAddresses: string[]
): Promise<TokenPrice[]> => {
  if (!hasOkxCreds()) {
    console.warn('[okx.dexPrices] OKX credentials missing, skipping price fetch');
    return [];
  }
  const path = `/api/v5/dex/aggregator/all-tokens?chainId=${XLAYER_CHAIN_ID}`;
  const wanted = new Set(tokenAddresses.map((a) => a.toLowerCase()));

  try {
    const res = await axios.get(`${OKX_BASE}${path}`, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: okxHeaders('GET', path),
    });
    const payload = res.data as {
      code?: string;
      data?: Array<{
        tokenContractAddress?: string;
        tokenSymbol?: string;
        tokenPrice?: string;
      }>;
    };
    if (!payload?.data || !Array.isArray(payload.data)) return [];

    const results: TokenPrice[] = [];
    for (const row of payload.data) {
      const addr = (row.tokenContractAddress ?? '').toLowerCase();
      if (wanted.size > 0 && !wanted.has(addr)) continue;
      results.push({
        symbol: row.tokenSymbol ?? '',
        price: row.tokenPrice ?? '0',
        chainId: String(XLAYER_CHAIN_ID),
      });
    }
    return results;
  } catch (err) {
    console.warn('[okx.dexPrices] getOkxTokenPrices failed:', describeAxiosErr(err));
    return [];
  }
};

// -----------------------------------------------------------------------------
// getOkxWalletPortfolio — total USD value + token breakdown for an address.
// Endpoint: GET /api/v5/wallet/asset/total-value-by-address?address={a}&chains=196&assetType=0
// Returns an empty portfolio on any failure so callers can safely skip.
// -----------------------------------------------------------------------------

export const getOkxWalletPortfolio = async (
  address: string
): Promise<Portfolio> => {
  if (!hasOkxCreds()) {
    console.warn('[okx.dexPrices] OKX credentials missing, skipping portfolio fetch');
    return EMPTY_PORTFOLIO;
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return EMPTY_PORTFOLIO;
  }

  const path = `/api/v5/wallet/asset/total-value-by-address?address=${address}&chains=${XLAYER_CHAIN_ID}&assetType=0`;

  try {
    const res = await axios.get(`${OKX_BASE}${path}`, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: okxHeaders('GET', path),
    });
    const payload = res.data as {
      code?: string;
      data?: Array<{
        totalValue?: string;
        assets?: Array<{
          symbol?: string;
          balance?: string;
          tokenPrice?: string;
          usdValue?: string;
          value?: string;
        }>;
      }>;
    };

    const first = payload?.data?.[0];
    if (!first) return EMPTY_PORTFOLIO;

    const totalUsdValue = first.totalValue ?? '0';
    const rawAssets = Array.isArray(first.assets) ? first.assets : [];
    const tokens: PortfolioToken[] = rawAssets.map((a) => ({
      symbol: a.symbol ?? '',
      balance: a.balance ?? '0',
      usdValue: a.usdValue ?? a.value ?? '0',
    }));
    return { totalUsdValue, tokens };
  } catch (err) {
    console.warn('[okx.dexPrices] getOkxWalletPortfolio failed:', describeAxiosErr(err));
    return EMPTY_PORTFOLIO;
  }
};
