import CodePanel from '@/components/amber/CodePanel'

const CURL_SNIPPET = `curl "https://amber-mcp.xyz/memory/query?identity=0x1a2b...&q=deploy config"

HTTP/1.1 402 Payment Required
www-authenticate: Payment realm="AMBER", scheme="x402-exact", network="eip155:196"
payment-required: eyJ4NDAyVmVyc2lvbiI6MiwicmVzb3VyY2Ui...`

const MCP_SNIPPET = `// 1. initialize
POST /mcp  { "jsonrpc": "2.0", "id": 1, "method": "initialize",
  "params": { "protocolVersion": "2025-06-18", "capabilities": {},
              "clientInfo": { "name": "my-agent", "version": "1.0" } } }

// 2. tools/list — all 33 tools, memory_query, memory_write, ...
POST /mcp  { "jsonrpc": "2.0", "id": 2, "method": "tools/list" }

// 3. call a tool
POST /mcp  { "jsonrpc": "2.0", "id": 3, "method": "tools/call",
  "params": { "name": "memory_query",
              "arguments": { "identity": "0x1a2b...", "q": "deploy config" } } }`

const IDENTITY_SNIPPET = `curl https://amber-mcp.xyz/agent.json

{
  "$schema": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "AMBER",
  "x402Support": true,
  "supportedSchemes": ["exact", "period"],
  "identity": {
    "erc8004Registry": "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432",
    "chainId": 196
  },
  "services": [
    { "name": "MCP", "type": "A2MCP", "endpoint": "https://amber-mcp.xyz/mcp" },
    { "name": "REST", "type": "HTTP", "endpoint": "https://amber-mcp.xyz" }
  ]
}`

export default function QuickstartPanels() {
  return (
    <div className="grid gap-6">
      <CodePanel code={CURL_SNIPPET} label="curl · GET /memory/query" />
      <CodePanel code={MCP_SNIPPET} label="MCP · initialize → tools/list → tools/call" />
      <CodePanel code={IDENTITY_SNIPPET} label="GET /agent.json · ERC-8004" />
    </div>
  )
}
