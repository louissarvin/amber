import CodePanel from '@/components/amber/CodePanel'

const FLOW = `> GET /memory/query?identity=0x1a2b...&q=deploy config
< HTTP/1.1 402 Payment Required
< WWW-Authenticate: Payment realm="AMBER", scheme="x402-exact",
                     network="eip155:196", version="2"
< payment-required: {
    x402Version: 2,
    accepts: [{
      scheme: "exact",
      network: "eip155:196",
      asset: "0x779ded...713736",   // USD₮0 on X Layer
      amount: "500",                 // 0.0005 USD₮0, atomic units
      payTo: "0x0fbfa7...9d52f967",
      maxTimeoutSeconds: 300
    }]
  }

  // wallet signs an EIP-3009 transferWithAuthorization once —
  // no gas, no separate billing account

> GET /memory/query?identity=0x1a2b...&q=deploy config
> X-PAYMENT: <base64 signed authorization>

< HTTP/1.1 200 OK
< PAYMENT-RESPONSE: { settled: true, chain: "eip155:196" }
< { "success": true, "data": { "results": [ ... ] } }`

export default function RequestFlowPanel() {
  return <CodePanel code={FLOW} label="GET /memory/query · x402 exact" />
}
