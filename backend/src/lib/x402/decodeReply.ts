import { PAYMENT_DEBUG } from '../../config/main-config.ts';

// -----------------------------------------------------------------------------
// x402 PAYMENT-SIGNATURE reply decoder
//
// The wire shape from `onchainos payment pay` is documented as:
//
//   base64(JSON.stringify({
//     scheme: "exact",
//     network: "eip155:196",
//     payload: {
//       authorization: {
//         from, to, value, validAfter, validBefore, nonce
//       },
//       signature: "0x..."
//     }
//   }))
//
// If OKX changes the shape at runtime, patch this file only.
// PAYMENT_DEBUG=true logs the raw base64 header for diagnostics.
// -----------------------------------------------------------------------------

export interface X402ReplyExact {
  scheme: string;
  network: string;
  payload: {
    authorization: {
      from: string;
      to: string;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: string;
    };
    signature: string;
  };
}

export class DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecodeError';
  }
}

export const decodeReply = (headerValue: string): X402ReplyExact => {
  // Strict input contract: caller (x402Middleware.readBase64HeaderStrict)
  // must have already validated the wire shape (single string, base64,
  // reasonable length). We defense-in-depth here — no array coercion, no
  // silent fallback.
  if (typeof headerValue !== 'string') {
    throw new DecodeError('headerValue must be a string');
  }
  if (headerValue.length === 0) {
    throw new DecodeError('headerValue must not be empty');
  }
  if (PAYMENT_DEBUG) {
    // Only log raw signature payload behind an explicit debug flag.
    console.log('[x402.decodeReply] raw header (base64):', headerValue.slice(0, 512));
  }

  let jsonStr: string;
  try {
    jsonStr = Buffer.from(headerValue, 'base64').toString('utf8');
  } catch (err) {
    throw new DecodeError(`base64 decode failed: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    throw new DecodeError(`JSON parse failed: ${(err as Error).message}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new DecodeError('reply payload is not a JSON object');
  }

  const p = parsed as Record<string, unknown>;
  const scheme = String(p.scheme ?? '');
  const network = String(p.network ?? '');
  const payloadRaw = p.payload;
  if (typeof payloadRaw !== 'object' || payloadRaw === null) {
    throw new DecodeError('reply payload.payload missing');
  }
  const payload = payloadRaw as Record<string, unknown>;
  const auth = payload.authorization;
  const signature = payload.signature;
  if (typeof auth !== 'object' || auth === null) {
    throw new DecodeError('reply payload.authorization missing');
  }
  if (typeof signature !== 'string') {
    throw new DecodeError('reply payload.signature missing');
  }

  const a = auth as Record<string, unknown>;
  const required = ['from', 'to', 'value', 'validAfter', 'validBefore', 'nonce'];
  for (const field of required) {
    if (typeof a[field] !== 'string' && typeof a[field] !== 'number') {
      throw new DecodeError(`authorization.${field} missing or wrong type`);
    }
  }

  return {
    scheme,
    network,
    payload: {
      authorization: {
        from: String(a.from),
        to: String(a.to),
        value: String(a.value),
        validAfter: String(a.validAfter),
        validBefore: String(a.validBefore),
        nonce: String(a.nonce),
      },
      signature,
    },
  };
};
