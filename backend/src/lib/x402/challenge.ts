import {
  ASP_WALLET_ADDRESS,
  PERMIT2_ADDRESS,
  PUBLIC_BASE_URL,
  USDT_DECIMALS,
  USDT_EIP712_NAME,
  USDT_EIP712_VERSION,
  USDT_SYMBOL,
  USDT_XLAYER_ADDRESS,
  X402_ENABLE_PERIOD,
  XLAYER_CHAIN_ID,
} from '../../config/main-config.ts';

// -----------------------------------------------------------------------------
// x402 v2 challenge builders (pure — no I/O)
//
// Reference: https://docs.x402.org/core-concepts/http-402
//            https://docs.x402.org/schemes/overview  (`exact` scheme only)
//
// Wire format is the base64 of JSON.stringify(challenge), sent via header
// `PAYMENT-REQUIRED`. All amounts are strings (per spec), 6-decimal USDT
// atomic.
// -----------------------------------------------------------------------------

export type HttpMethod = 'POST' | 'GET' | 'DELETE';

export interface X402AcceptExact {
  scheme: 'exact';
  network: string; // "eip155:196"
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  // Per the OKX A2MCP 402 doc, `extra` carries ONLY name + version — the two
  // fields a verifier needs to rebuild the EIP-712 domain the buyer signs.
  extra: {
    name: string;
    version: string;
  };
}

export interface X402AcceptPeriod {
  scheme: 'period';
  network: string;
  asset: string;
  amount: string;
  decimals: number;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: {
    name: string;
    version: string;
    assetTransferMethod: 'permit2';
    permit2Address: string;
    sessionUri: string;
    tokenDecimals: number;
    tokenSymbol: string;
  };
}

export type X402Accept = X402AcceptExact | X402AcceptPeriod;

export interface X402Challenge {
  x402Version: 2;
  resource: {
    url: string;
    // OKX A2MCP doc `resource` shape: { url, description, mimeType }.
    description: string;
    mimeType: string;
    method: HttpMethod;
    outputSchema: {
      input:
        | { type: 'http'; method: HttpMethod; bodySchema: object }
        | { type: 'http'; method: HttpMethod; queryParams: object };
    };
  };
  accepts: X402Accept[];
}

// Default description advertised in the 402 `resource` block when the caller
// does not supply a per-endpoint one.
const DEFAULT_RESOURCE_DESCRIPTION =
  'AMBER persistent memory layer for AI agents — pay-per-call x402 endpoint on X Layer.';

export interface BuildChallengeOpts {
  url: string;
  method: HttpMethod;
  priceAtomic: number;
  inputSchema?: object;
  maxTimeoutSeconds?: number;
  description?: string;
}

export const buildExactChallenge = ({
  url,
  method,
  priceAtomic,
  inputSchema,
  maxTimeoutSeconds,
  description,
}: BuildChallengeOpts): X402Challenge => {
  const input =
    method === 'GET'
      ? {
          type: 'http' as const,
          method,
          queryParams: inputSchema ?? {},
        }
      : {
          type: 'http' as const,
          method,
          bodySchema: inputSchema ?? {},
        };

  const accepts: X402Accept[] = [
    {
      scheme: 'exact',
      network: `eip155:${XLAYER_CHAIN_ID}`,
      asset: USDT_XLAYER_ADDRESS,
      amount: String(priceAtomic),
      payTo: ASP_WALLET_ADDRESS,
      maxTimeoutSeconds: maxTimeoutSeconds ?? 300,
      extra: {
        name: USDT_EIP712_NAME,
        version: USDT_EIP712_VERSION,
      },
    },
  ];

  if (X402_ENABLE_PERIOD) {
    accepts.push({
      scheme: 'period',
      network: `eip155:${XLAYER_CHAIN_ID}`,
      asset: USDT_XLAYER_ADDRESS,
      amount: String(priceAtomic),
      decimals: USDT_DECIMALS,
      payTo: ASP_WALLET_ADDRESS,
      maxTimeoutSeconds: maxTimeoutSeconds ?? 300,
      extra: {
        name: USDT_EIP712_NAME,
        version: USDT_EIP712_VERSION,
        assetTransferMethod: 'permit2',
        permit2Address: PERMIT2_ADDRESS,
        sessionUri: `${PUBLIC_BASE_URL}/subscription/open`,
        tokenDecimals: USDT_DECIMALS,
        tokenSymbol: USDT_SYMBOL,
      },
    });
  }

  return {
    x402Version: 2,
    resource: {
      url,
      description: description ?? DEFAULT_RESOURCE_DESCRIPTION,
      mimeType: 'application/json',
      method,
      outputSchema: { input },
    },
    accepts,
  };
};

export const encodeChallenge = (challenge: X402Challenge): string => {
  return Buffer.from(JSON.stringify(challenge), 'utf8').toString('base64');
};
