#!/usr/bin/env node
// Usage: bun run scripts/register-asp.ts
// Prints the agent.json that will be served and the OKX.AI registration checklist.
//
// This script does not mutate on-chain state. Registration on the ERC-8004
// registry contract and on the OKX.AI marketplace is a manual/operator step;
// we only surface the URLs and payloads a human needs to complete it.

import 'dotenv/config';

const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const ERC8004_REGISTRY_ADDRESS =
  process.env.ERC8004_REGISTRY_ADDRESS || '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432';
const ASP_WALLET_ADDRESS = process.env.ASP_WALLET_ADDRESS || '';
const XLAYER_CHAIN_ID = process.env.XLAYER_CHAIN_ID || '196';

const die = (msg: string): never => {
  console.error(`[register-asp] ${msg}`);
  process.exit(1);
};

if (!PUBLIC_BASE_URL) {
  die('PUBLIC_BASE_URL is not set in .env — cannot generate registration URLs.');
}

const agentJsonUrl = `${PUBLIC_BASE_URL}/agent.json`;
const wellKnownUrl = `${PUBLIC_BASE_URL}/.well-known/agent.json`;
const mcpEndpoint = `${PUBLIC_BASE_URL}/mcp`;

console.log('');
console.log('===========================================================');
console.log('  AMBER — OKX.AI Marketplace / ERC-8004 registration guide');
console.log('===========================================================');
console.log('');
console.log('Public agent.json will be served at:');
console.log(`  1. ${agentJsonUrl}`);
console.log(`  2. ${wellKnownUrl}   (RFC 8615 well-known alias)`);
console.log('');
console.log('X Layer registry contract:');
console.log(`  chainId:  ${XLAYER_CHAIN_ID}`);
console.log(`  registry: ${ERC8004_REGISTRY_ADDRESS}`);
console.log(`  asp:      ${ASP_WALLET_ADDRESS || '<ASP_WALLET_ADDRESS not set>'}`);
console.log('');
console.log('Suggested on-chain call (ERC-8004 v1):');
console.log(`  registry.registerAgent(agentJsonUrl="${agentJsonUrl}")`);
console.log('  Signed from the ASP wallet on X Layer.');
console.log('');
console.log('Registration checklist:');
console.log(`  [ ] 1. Confirm GET ${agentJsonUrl} returns 200`);
console.log('  [ ] 2. Go to https://www.okx.ai/tutorial/asp → click "Add ASP"');
console.log(`  [ ] 3. Paste MCP endpoint: ${mcpEndpoint}`);
console.log('  [ ] 4. Category: Software Utility');
console.log('  [ ] 5. Confirm x402 support is checked');
console.log('  [ ] 6. Submit for review');
console.log('');
console.log('Once approved AMBER will appear in the OKX.AI marketplace and');
console.log('be discoverable by any x402-aware agent client.');
console.log('');
