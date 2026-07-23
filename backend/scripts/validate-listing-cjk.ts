#!/usr/bin/env bun
/**
 * validate-listing-cjk.ts — mirrors okx-ai identity-invariants CJK-width rules.
 * East-Asian display width: CJK = 2, ASCII = 1. Each serviceDescription part ≤200.
 * serviceName length 5–30 (char count). fee quoted numeric string.
 *
 * Usage: bun scripts/validate-listing-cjk.ts [path/to/listing-services.json]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const path = resolve(process.argv[2] ?? 'scripts/listing-services.json');

const cjkWidth = (s: string): number => {
  let w = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    // Rough CJK / fullwidth band used by marketplace QA.
    if (
      (code >= 0x1100 && code <= 0x11ff) ||
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
};

interface Svc {
  serviceName: string;
  serviceDescription: string;
  serviceType: string;
  fee: string;
  endpoint: string;
}

const raw = JSON.parse(readFileSync(path, 'utf8')) as Svc[];
let failures = 0;

for (const [i, s] of raw.entries()) {
  const label = `service[${i}] ${s.serviceName}`;
  if (!s.serviceName || s.serviceName.length < 5 || s.serviceName.length > 30) {
    console.error(`FAIL ${label}: serviceName length must be 5–30`);
    failures += 1;
  }
  if (s.serviceType !== 'A2MCP' && s.serviceType !== 'A2A') {
    console.error(`FAIL ${label}: serviceType must be A2MCP or A2A`);
    failures += 1;
  }
  if (typeof s.fee !== 'string' || !/^\d+(\.\d{1,6})?$/.test(s.fee)) {
    console.error(`FAIL ${label}: fee must be a quoted numeric string ≤6 dp`);
    failures += 1;
  }
  if (s.serviceType === 'A2MCP') {
    if (!s.endpoint?.startsWith('https://')) {
      console.error(`FAIL ${label}: endpoint must start with https://`);
      failures += 1;
    }
    if (s.endpoint.length > 512) {
      console.error(`FAIL ${label}: endpoint > 512 chars`);
      failures += 1;
    }
  }
  const parts = s.serviceDescription.split('\n');
  if (parts.length < 2) {
    console.error(`FAIL ${label}: serviceDescription needs 2 lines (capability / provide)`);
    failures += 1;
  } else {
    const [a, b] = parts;
    const wa = cjkWidth(a ?? '');
    const wb = cjkWidth(b ?? '');
    if (wa > 200 || wb > 200) {
      console.error(`FAIL ${label}: line widths ${wa}/${wb} (max 200 CJK-width each)`);
      failures += 1;
    }
    const banned = /(http|github|claude|nodejs|postgres|docker|disclaimer)/i;
    if (banned.test(s.serviceDescription)) {
      console.error(`FAIL ${label}: description may contain banned tech/link wording`);
      failures += 1;
    }
  }
  console.log(`OK   ${label} (name=${s.serviceName.length} fee=${s.fee})`);
}

if (failures) {
  console.error(`\n${failures} finding(s) — fix before validate-listing / agent create`);
  process.exit(1);
}
console.log(`\nPASS ${raw.length} services — ready for Onchain OS validate-listing`);
