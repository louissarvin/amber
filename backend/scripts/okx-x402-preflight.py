#!/usr/bin/env python3
"""
OKX x402 facilitator credential preflight.

Run this ON THE VPS from /root/amber/backend:

    python3 scripts/okx-x402-preflight.py

It signs an OKX Web3 REST request with the OKX_API_KEY / OKX_SECRET_KEY /
OKX_PASSPHRASE from .env and calls the facilitator endpoint the official
OKX Payment SDK hits at boot (GET /api/v6/pay/x402/supported).

Verdict:
  HTTP 200 + a supported list containing exact @ eip155:196  -> creds OK, migrate.
  HTTP 401/403 (JSON auth error)                             -> keys lack x402-pay
                                                                scope; provision a
                                                                project key in the OKX
                                                                Web3 Developer Portal.
"""
import base64
import datetime
import hashlib
import hmac
import json
import os
import urllib.error
import urllib.request


def load_env(path: str = ".env") -> dict:
    env = {}
    if not os.path.exists(path):
        return env
    for line in open(path):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def okx_timestamp() -> str:
    now = datetime.datetime.now(datetime.timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def main() -> None:
    env = load_env()
    key = env.get("OKX_API_KEY")
    sec = env.get("OKX_SECRET_KEY")
    pw = env.get("OKX_PASSPHRASE")
    print("creds present -> api_key:", bool(key), "secret:", bool(sec), "passphrase:", bool(pw))
    if not (key and sec and pw):
        print("VERDICT: OKX_API_KEY / OKX_SECRET_KEY / OKX_PASSPHRASE missing from .env")
        return

    base = "https://web3.okx.com"
    path = "/api/v6/pay/x402/supported"
    ts = okx_timestamp()
    prehash = ts + "GET" + path
    sign = base64.b64encode(
        hmac.new(sec.encode(), prehash.encode(), hashlib.sha256).digest()
    ).decode()
    req = urllib.request.Request(
        base + path,
        headers={
            "OK-ACCESS-KEY": key,
            "OK-ACCESS-SIGN": sign,
            "OK-ACCESS-TIMESTAMP": ts,
            "OK-ACCESS-PASSPHRASE": pw,
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0",
        },
    )
    try:
        r = urllib.request.urlopen(req, timeout=20)
        code, body = r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        code, body = e.code, e.read().decode()
    except Exception as e:  # noqa: BLE001
        print("REQUEST ERROR:", e)
        return

    print("HTTP", code)
    print(body[:1200])
    ok = code == 200 and "eip155:196" in body and "exact" in body
    if ok:
        print("\nVERDICT: CREDS OK. The facilitator accepts our keys and lists exact @ eip155:196. Safe to migrate to the official SDK.")
    elif code == 200:
        print("\nVERDICT: 200 but eip155:196/exact NOT listed. Ask OKX which network/scheme our project supports.")
    else:
        print(f"\nVERDICT: HTTP {code}. If this is a JSON auth error, the keys lack x402-pay scope; provision a project key with Pay/x402 access in the OKX Web3 Developer Portal. If it is a plain WAF/edge 403, check the VPS is not routing OKX traffic through Cloudflare WARP.")


if __name__ == "__main__":
    main()
