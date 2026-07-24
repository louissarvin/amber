#!/usr/bin/env bash
# =============================================================================
# onchainos-register-checklist.sh — copy-paste Onchain OS steps after HTTPS is live.
# Official sources:
#   - okx-ai/references/identity-invariants.md (service JSON keys + 2-line desc)
#   - Hackathon: https://web3.okx.com/xlayer/build-x-series (Jul 27 23:59 UTC — extended)
# Replace AMBER_BASE_URL before agent create — endpoint is immutable on-chain.
# =============================================================================

set -euo pipefail

BASE="${AMBER_BASE_URL:-https://amber-mcp.xyz}"
SERVICES_JSON="$(cd "$(dirname "$0")" && pwd)/listing-services.json"

echo "=== AMBER Onchain OS checklist ==="
echo "Base URL (MUST be final HTTPS): ${BASE}"
echo ""
echo "1) Install skills"
echo "   npx skills add okx/onchainos-skills --yes -g"
echo ""
echo "2) Wallet"
echo "   onchainos wallet login <email>"
echo "   onchainos wallet status"
echo ""
echo "3) Preflight"
echo "   onchainos preflight"
echo "   onchainos agent pre-check --role asp"
echo ""
echo "4) Public readiness (local smoke)"
echo "   curl -sS ${BASE}/healthz | head -c 200; echo"
echo "   curl -sS ${BASE}/.well-known/amber | head -c 200; echo"
echo "   curl -sS ${BASE}/listing.json | head -c 200; echo"
echo "   curl -sS ${BASE}/agent.json | head -c 200; echo"
echo "   AMBER_BASE_URL=${BASE} bash scripts/demo-flow.sh"
echo "   AMBER_BASE_URL=${BASE} bash scripts/onchainos-x402-check.sh"
echo ""
echo "5) Register (natural language to Claude Code with onchainos-skills):"
echo "   Help me register an A2MCP ASP on OKX.AI using Onchain OS"
echo "   Name: AMBER"
echo "   Description: AMBER treats your ERC-8004 identity as the primary key of a persistent agent state store — not just a marketplace discovery record. Write once, recall across Claude Code / Codex / any MCP client. Merkle-attested on X Layer."
echo "   Preferred language: en-US"
echo "   Paste --service from: ${SERVICES_JSON}"
echo "   Endpoints already point at https://amber-mcp.xyz"
echo ""
echo "6) Activate"
echo "   Activate my ASP with preferred language en-US"
echo ""
echo "7) List"
echo "   Help me list my ASP on OKX.AI using Onchain OS"
echo ""
echo "8) Social Buzz + form (deadline Jul 27 23:59 UTC — extended)"
echo "   curl -sS ${BASE}/social/card   # copy tweet + #OKXAI"
echo "   curl -sS ${BASE}/report/revenue"
echo "   Form: https://forms.gle/mddEUagmDbyV37ws8"
echo ""
echo "Keep X402_ENABLE_PERIOD=false until x402-check greens."
