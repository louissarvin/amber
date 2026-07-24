#!/usr/bin/env bash
# =============================================================================
# onchainos-x402-check.sh — listing gate helper for AMBER ASP.
# Validates paid REST x402 and MCP paid-tool challenge behavior.
# =============================================================================

set -euo pipefail

BASE_URL="${AMBER_BASE_URL:-${PUBLIC_BASE_URL:-https://amber-mcp.xyz}}"
MCP_URL="${BASE_URL%/}/mcp"
WRITE_URL="${BASE_URL%/}/memory/write"
QUERY_URL="${BASE_URL%/}/memory/query"
QUERY_CHECK_URL="${QUERY_URL}?identity=0xabcdefabcdefabcdefabcdefabcdefabcdefabcd&q=probe"
MCP_PROTOCOL_VERSION="${MCP_PROTOCOL_VERSION:-2025-06-18}"

PASS=0
FAIL=0

echo "=== AMBER x402 endpoint probe ==="
echo "MCP:   ${MCP_URL}"
echo "Write: ${WRITE_URL}"
echo "Query: ${QUERY_URL}"

echo ""
echo "----- curl x402 probe (paid REST query — onchainos payment pay validates inline) -----"
# NOTE: onchainos agent x402-check does not exist as a standalone command.
# Payment validation happens inline via onchainos payment pay.
# This curl probe checks that the PAYMENT-REQUIRED challenge is emitted correctly.
PROBE_STATUS=$(curl -sS -o /tmp/amber_probe_body -D /tmp/amber_probe_headers -w "%{http_code}" \
  "${QUERY_CHECK_URL}" || true)
echo "HTTP ${PROBE_STATUS}"
if grep -qi 'PAYMENT-REQUIRED:' /tmp/amber_probe_headers 2>/dev/null; then
  echo "PASS: PAYMENT-REQUIRED header present on query endpoint"
  PASS=$((PASS + 1))
elif [ "${PROBE_STATUS}" = "200" ]; then
  echo "PASS: query returned 200 (may be in free tier or dev mode)"
  PASS=$((PASS + 1))
else
  echo "FAIL: query returned ${PROBE_STATUS} without PAYMENT-REQUIRED"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "----- MCP paid tool: memory_query (expects 402 + PAYMENT-REQUIRED) -----"
INIT_STATUS=$(curl -sS -o /tmp/amber_mcp_init_body -D /tmp/amber_mcp_init_headers -w "%{http_code}" \
  -X POST "${MCP_URL}" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "MCP-Protocol-Version: ${MCP_PROTOCOL_VERSION}" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"amber-x402-check","version":"1.0.0"}}}' || true)
SESSION_ID="$(python3 - <<'PY'
from pathlib import Path
for line in Path('/tmp/amber_mcp_init_headers').read_text().splitlines():
    if line.lower().startswith('mcp-session-id:'):
        print(line.split(':', 1)[1].strip())
        break
PY
)"

if [ "${INIT_STATUS}" != "200" ] || [ -z "${SESSION_ID}" ]; then
  echo "FAIL: MCP initialize returned HTTP ${INIT_STATUS} without session id"
  FAIL=$((FAIL + 1))
else
  MCP_STATUS=$(curl -sS -o /tmp/amber_mcp_body -D /tmp/amber_mcp_headers -w "%{http_code}" \
    -X POST "${MCP_URL}" \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' \
    -H "MCP-Protocol-Version: ${MCP_PROTOCOL_VERSION}" \
    -H "Mcp-Session-Id: ${SESSION_ID}" \
    -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"memory_query","arguments":{"identity":"0xabcdefabcdefabcdefabcdefabcdefabcdefabcd","q":"probe"}}}' || true)
  echo "HTTP ${MCP_STATUS}"
  if grep -qi 'PAYMENT-REQUIRED:' /tmp/amber_mcp_headers 2>/dev/null; then
    echo "PAYMENT-REQUIRED header: PRESENT on MCP memory_query"
    PASS=$((PASS + 1))
  else
    echo "FAIL: MCP memory_query did not emit PAYMENT-REQUIRED"
    FAIL=$((FAIL + 1))
  fi
fi

echo ""
echo "----- REST write endpoint (free-tier eligible; expects 200 or 402) -----"
STATUS=$(curl -sS -o /tmp/amber_x402_body -D /tmp/amber_x402_headers -w "%{http_code}" \
  -X POST "${WRITE_URL}" \
  -H 'Content-Type: application/json' \
  -d '{"identity":"0xabcdefabcdefabcdefabcdefabcdefabcdefabcd","content":"x402-check probe"}' || true)
echo "HTTP ${STATUS}"
if [ "${STATUS}" = "200" ]; then
  echo "PASS: write accepted under free tier"
  PASS=$((PASS + 1))
elif grep -qi 'PAYMENT-REQUIRED:' /tmp/amber_x402_headers 2>/dev/null; then
  echo "PASS: write emitted PAYMENT-REQUIRED after free tier"
  PASS=$((PASS + 1))
else
  echo "FAIL: write returned ${STATUS} without expected success or x402 challenge"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "----- REST query endpoint (always paid, expects 402) -----"
QSTATUS=$(curl -sS -o /tmp/amber_x402_qbody -D /tmp/amber_x402_qheaders -w "%{http_code}" \
  "${QUERY_CHECK_URL}" || true)
echo "HTTP ${QSTATUS}"
if grep -qi 'PAYMENT-REQUIRED:' /tmp/amber_x402_qheaders 2>/dev/null; then
  echo "PAYMENT-REQUIRED header: PRESENT on query"
  PASS=$((PASS + 1))
else
  echo "FAIL: query returned ${QSTATUS} without PAYMENT-REQUIRED"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "----- Public stats: /public/stats (optional Revenue Rocket evidence) -----"
STATS_STATUS=$(curl -sS -o /tmp/amber_stats_body -w "%{http_code}" \
  "${BASE_URL%/}/public/stats" || true)
echo "HTTP ${STATS_STATUS}"
if [ "${STATS_STATUS}" = "200" ]; then
  PASS=$((PASS + 1))
else
  echo "NOTE: public stats not available yet; this is optional for local smoke."
fi

echo ""
echo "=== Summary: ${PASS} checks passed, ${FAIL} failed ==="
if [ "${FAIL}" -eq 0 ]; then
  echo "All required checks passed. Proceed to OKX.AI registration:"
  echo "  1. onchainos validate-listing"
  echo "  2. onchainos agent pre-check --role asp"
  echo "  3. onchainos agent create  (via natural language in Claude Code)"
  echo "  4. onchainos agent activate"
else
  echo "Fix ${FAIL} failing check(s) before registering on OKX.AI."
  exit 1
fi
