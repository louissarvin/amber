#!/usr/bin/env bash
# =============================================================================
# smoke.sh — unauthenticated 402 challenge shape check for all four AMBER
# memory endpoints. Verifies the base64 challenge payload has the correct
# network / asset / amount / payTo / x402Version.
# =============================================================================

set -euo pipefail

BASE_URL="${AMBER_BASE_URL:-http://localhost:3700}"
EXPECTED_NETWORK="eip155:196"
EXPECTED_ASSET="0x1e4a5963abfd975d8c9021ce480b42188849d41d"
EXPECTED_PAY_TO="${ASP_WALLET_ADDRESS:-}"

echo "Smoke target: ${BASE_URL}"
echo "Expected network: ${EXPECTED_NETWORK}"
echo "Expected asset:   ${EXPECTED_ASSET}"

RED=$'\033[31m'
GRN=$'\033[32m'
RST=$'\033[0m'

fail() { echo "${RED}FAIL${RST} $*"; exit 1; }
pass() { echo "${GRN}OK${RST}   $*"; }

decode_challenge() {
  local header="$1"
  echo -n "${header}" | base64 -d 2>/dev/null || echo -n "${header}" | base64 --decode
}

check_endpoint() {
  local method="$1"
  local path="$2"
  local body="$3"
  local expected_amount="$4"

  echo ""
  echo "----- ${method} ${path} -----"

  local tmp_headers
  tmp_headers="$(mktemp)"
  local status
  if [[ "${method}" == "POST" ]]; then
    status=$(curl -sS -o /tmp/amber_smoke_body -D "${tmp_headers}" -w "%{http_code}" \
      -X POST "${BASE_URL}${path}" \
      -H 'Content-Type: application/json' \
      -d "${body}") || true
  else
    status=$(curl -sS -o /tmp/amber_smoke_body -D "${tmp_headers}" -w "%{http_code}" \
      -X GET "${BASE_URL}${path}?${body}") || true
  fi

  if [[ "${status}" != "402" ]]; then
    echo "response:"
    cat /tmp/amber_smoke_body
    fail "expected 402, got ${status}"
  fi
  pass "status is 402"

  local challenge_header
  challenge_header=$(grep -i '^PAYMENT-REQUIRED:' "${tmp_headers}" | head -1 | awk -F': ' '{print $2}' | tr -d '\r')
  if [[ -z "${challenge_header}" ]]; then
    cat "${tmp_headers}"
    fail "PAYMENT-REQUIRED header missing"
  fi
  pass "PAYMENT-REQUIRED header present"

  local decoded
  decoded=$(decode_challenge "${challenge_header}")
  if [[ -z "${decoded}" ]]; then
    fail "could not base64-decode PAYMENT-REQUIRED"
  fi

  echo "challenge (decoded, first 400 chars):"
  echo "${decoded}" | head -c 400 ; echo

  local x402_version
  # Extract the numeric VALUE after "x402Version": — grep -oE '[0-9]+' would also
  # match "402" inside the key name itself, so we strip everything up to the colon first.
  x402_version=$(echo "${decoded}" | grep -oE '"x402Version"[[:space:]]*:[[:space:]]*[0-9]+' | grep -oE ':[[:space:]]*[0-9]+' | grep -oE '[0-9]+' || true)
  [[ "${x402_version}" == "2" ]] || fail "x402Version != 2 (got '${x402_version}')"
  pass "x402Version=2"

  echo "${decoded}" | grep -q "\"network\":\"${EXPECTED_NETWORK}\"" \
    || fail "network mismatch (want ${EXPECTED_NETWORK})"
  pass "network=${EXPECTED_NETWORK}"

  echo "${decoded}" | grep -qi "\"asset\":\"${EXPECTED_ASSET}\"" \
    || fail "asset mismatch (want ${EXPECTED_ASSET})"
  pass "asset=${EXPECTED_ASSET}"

  echo "${decoded}" | grep -q "\"amount\":\"${expected_amount}\"" \
    || fail "amount mismatch (want ${expected_amount})"
  pass "amount=${expected_amount}"

  if [[ -n "${EXPECTED_PAY_TO}" ]]; then
    echo "${decoded}" | grep -qi "\"payTo\":\"${EXPECTED_PAY_TO}\"" \
      || fail "payTo mismatch (want ${EXPECTED_PAY_TO})"
    pass "payTo=${EXPECTED_PAY_TO}"
  else
    echo "note: ASP_WALLET_ADDRESS unset — skipping payTo comparison"
  fi

  rm -f "${tmp_headers}"
}

# NOTE: /memory/write is skipped for the amount check because the free-tier
# quota may allow the request through with a 200 instead of emitting a 402.
# To force the write challenge, exceed FREE_TIER_WRITES_PER_IDENTITY first.

check_endpoint "GET" "/memory/query" "identity=0xabcdefabcdefabcdefabcdefabcdefabcdefabcd&q=hello" "500"
check_endpoint "GET" "/memory/session-context" "identity=0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" "200"

echo ""
echo "----- GET /memory/list (free, expect 200) -----"
LIST_STATUS=$(curl -sS -o /tmp/amber_smoke_list -w "%{http_code}" \
  "${BASE_URL}/memory/list?identity=0xabcdefabcdefabcdefabcdefabcdefabcdefabcd&limit=5" || true)
[[ "${LIST_STATUS}" == "200" ]] || fail "list expected 200, got ${LIST_STATUS}"
pass "list status is 200"

echo ""
echo "----- GET /healthz -----"
HZ_STATUS=$(curl -sS -o /tmp/amber_smoke_hz -w "%{http_code}" "${BASE_URL}/healthz" || true)
[[ "${HZ_STATUS}" == "200" || "${HZ_STATUS}" == "503" ]] || fail "healthz unexpected ${HZ_STATUS}"
pass "healthz responded ${HZ_STATUS}"

echo ""
echo "----- POST /memory/write (may 200 on free tier or 402 when quota exhausted) -----"
curl -sS -o /tmp/amber_smoke_body -D /tmp/amber_smoke_headers -w "\nHTTP %{http_code}\n" \
  -X POST "${BASE_URL}/memory/write" \
  -H 'Content-Type: application/json' \
  -d '{"identity":"0xabcdefabcdefabcdefabcdefabcdefabcdefabcd","content":"smoke test"}' || true
echo "response body preview:"
head -c 400 /tmp/amber_smoke_body ; echo

echo ""
pass "smoke checks complete"
