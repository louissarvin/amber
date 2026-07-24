#!/usr/bin/env bash
# =============================================================================
# demo-flow.sh — judge-friendly one-shot AMBER walkthrough (free endpoints).
# Run against local dev or production with AMBER_BASE_URL set.
# =============================================================================

set -euo pipefail

BASE_URL="${AMBER_BASE_URL:-http://localhost:3700}"
IDENTITY="${AMBER_DEMO_IDENTITY:-0x0000000000000000000000000000000000000001}"

echo "AMBER demo flow"
echo "  base:     ${BASE_URL}"
echo "  identity: ${IDENTITY}"
echo ""

curl -sS "${BASE_URL}/healthz" | head -c 400
echo -e "\n"

echo "== Onboarding manifest =="
curl -sS "${BASE_URL}/.well-known/amber" | head -c 600
echo -e "\n...\n"

echo "== Listing tile =="
curl -sS "${BASE_URL}/listing.json" | head -c 400
echo -e "\n...\n"

echo "== Judging pack =="
curl -sS "${BASE_URL}/report/judging" | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print('tools', d['liveEvidence']['totals']['mcpTools'], 'services', d['liveEvidence']['totals']['listedServices'], 'readiness', d['launchReadiness']['status'])" 2>/dev/null || curl -sS "${BASE_URL}/report/judging" | head -c 400
echo -e "\n"

echo "== Demo pack (seed + preference + dossier + recall) =="
curl -sS -X POST "${BASE_URL}/memory/demo-pack" \
  -H 'Content-Type: application/json' \
  -d "{\"identity\":\"${IDENTITY}\",\"preference\":\"I build agentic products on OKX.AI with persistent ERC-8004 memory.\"}"

echo -e "\n\n== Lifestyle remember (REST) =="
curl -sS -X POST "${BASE_URL}/memory/lifestyle" \
  -H 'Content-Type: application/json' \
  -d "{\"identity\":\"${IDENTITY}\",\"content\":\"I prefer dark mode and concise OKX.AI demos.\",\"kind\":\"preference\"}" | head -c 500
echo -e "\n"

echo "== Who Am I =="
curl -sS -X POST "${BASE_URL}/memory/whoami" \
  -H 'Content-Type: application/json' \
  -d "{\"identity\":\"${IDENTITY}\"}" | head -c 500
echo -e "\n"

echo "== Portrait =="
curl -sS -o /dev/null -w "HTTP %{http_code}\n" "${BASE_URL}/portrait/${IDENTITY}.svg"

echo "== Avatar =="
curl -sS -o /dev/null -w "HTTP %{http_code}\n" "${BASE_URL}/assets/avatar.svg"

echo "== Public payments =="
curl -sS -o /dev/null -w "HTTP %{http_code}\n" "${BASE_URL}/public/payments"

echo "== Identity stats =="
curl -sS "${BASE_URL}/identity/${IDENTITY}" || true
echo ""

echo "Done. For paid x402 paths run: AMBER_BASE_URL=${BASE_URL} bash scripts/onchainos-x402-check.sh"
echo "Tip: MCP finance_brief + lifestyle_remember are the Finance + Lifestyle prize demos."
