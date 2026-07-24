import { describe, test, expect, afterAll } from 'bun:test';
import { readFileSync } from 'node:fs';
import { repoPath, closeRedis } from './helpers.ts';

// -----------------------------------------------------------------------------
// MCP integrity + count-truth guards.
//
// Approach: the `tools` array and `dispatchToolsCall` switch are NOT exported
// from mcpTransport.ts, and importing the module eagerly connects Redis and
// pulls in the whole service graph. To keep these structural invariants pure
// and DB-free we parse the source text (the "lighter mechanism" the task
// allows) to extract the declared tool names and the dispatch `case` labels.
//
// The one runtime import we do make is the exported MCP_TOOL_COUNT constant,
// so we can prove the exported count equals the real array length (anti-drift
// guard for /report/judging and /status/production-ready).
// -----------------------------------------------------------------------------

const src = readFileSync(repoPath('src/routes/mcpTransport.ts'), 'utf8');

// Tool names: each entry in `const tools = [ ... ]` declares a `name` field at
// 4-space indentation with a snake_case value. resource_link names ('Memory
// Portrait') and serverInfo names are indented deeper / not snake_case, so this
// pattern captures tool names only.
const parseToolNames = (): string[] => {
  const start = src.indexOf('const tools = [');
  const end = src.indexOf('const KNOWN_TOOLS');
  const slice = src.slice(start, end);
  return [...slice.matchAll(/^ {4}name:\s*'([a-z0-9_]+)'/gm)].map((m) => m[1]);
};

// Dispatch cases: brace-balance the `switch (name) { ... }` inside
// dispatchToolsCall so we only pick up that switch's case labels.
const parseDispatchCases = (): string[] => {
  const dispStart = src.indexOf('const dispatchToolsCall');
  const swStart = src.indexOf('switch (name) {', dispStart);
  let depth = 0;
  let end = -1;
  for (let i = src.indexOf('{', swStart); i < src.length; i += 1) {
    const c = src[i];
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const slice = src.slice(swStart, end);
  return [...slice.matchAll(/^\s*case\s+'([a-z0-9_]+)':/gm)].map((m) => m[1]);
};

// Per-tool outputSchema coverage: segment the `const tools = [ ... ]` slice at
// each 4-space-indented `name:` boundary so each segment holds exactly one
// tool object body (name → next name). A tool "has an outputSchema" iff its
// segment contains an `outputSchema:` key. dispatchToolsCall returns
// `structuredContent: payload` on a single shared path for EVERY tool, so per
// MCP 2025-06-18 every tool must declare an outputSchema or strict clients
// (Claude, Cursor, OKX dispatcher) will drop the structured payload.
const parseToolsMissingOutputSchema = (): string[] => {
  const start = src.indexOf('const tools = [');
  const end = src.indexOf('const KNOWN_TOOLS');
  const slice = src.slice(start, end);
  const matches = [...slice.matchAll(/^ {4}name:\s*'([a-z0-9_]+)'/gm)];
  const missing: string[] = [];
  for (let i = 0; i < matches.length; i += 1) {
    const from = matches[i].index ?? 0;
    const to = i + 1 < matches.length ? (matches[i + 1].index ?? slice.length) : slice.length;
    const body = slice.slice(from, to);
    if (!/\boutputSchema:/.test(body)) missing.push(matches[i][1]);
  }
  return missing;
};

const toolNames = parseToolNames();
const dispatchCases = parseDispatchCases();
const toolsMissingOutputSchema = parseToolsMissingOutputSchema();

afterAll(closeRedis);

describe('MCP tool/dispatch integrity', () => {
  test('source parse found a plausible tool set', () => {
    // Guard against a parser that silently matched nothing.
    expect(toolNames.length).toBeGreaterThanOrEqual(29);
    expect(dispatchCases.length).toBeGreaterThanOrEqual(29);
  });

  test('no duplicate tool names', () => {
    expect(new Set(toolNames).size).toBe(toolNames.length);
  });

  test('no duplicate dispatch cases', () => {
    expect(new Set(dispatchCases).size).toBe(dispatchCases.length);
  });

  test('every declared tool has a matching dispatch case (no orphan tools)', () => {
    const cases = new Set(dispatchCases);
    const orphans = toolNames.filter((t) => !cases.has(t));
    expect(orphans).toEqual([]);
  });

  test('every dispatch case maps to a declared tool (no orphan dispatch)', () => {
    const tools = new Set(toolNames);
    const orphans = dispatchCases.filter((c) => !tools.has(c));
    expect(orphans).toEqual([]);
  });
});

describe('MCP 2025-06-18 structured output compliance', () => {
  // dispatchToolsCall returns `structuredContent: payload` for every tool, so
  // every tool MUST declare an outputSchema. This guards against re-introducing
  // the drift where 24/33 tools returned structuredContent with no declared
  // schema and strict clients silently dropped it.
  test('every tool declares an outputSchema (structuredContent must be schema-backed)', () => {
    expect(toolsMissingOutputSchema).toEqual([]);
  });

  test('the dispatcher returns structuredContent on a single shared path for all tools', () => {
    // If this literal ever changes, revisit the assumption above that ALL tools
    // emit structuredContent and therefore all need an outputSchema.
    expect(src).toContain('structuredContent: payload');
  });

  test('outputSchema coverage is 33/33 (count-truth guard)', () => {
    const withSchema = toolNames.length - toolsMissingOutputSchema.length;
    expect(withSchema).toBe(toolNames.length);
    expect(withSchema).toBeGreaterThanOrEqual(33);
  });
});

describe('count truth (anti-drift guards)', () => {
  test('exported MCP_TOOL_COUNT equals the real tools array length', async () => {
    const { MCP_TOOL_COUNT } = await import('../src/routes/mcpTransport.ts');
    // MCP_TOOL_COUNT is `export const MCP_TOOL_COUNT = tools.length` — importing
    // it gives the runtime array length, which must equal the parsed count.
    expect(MCP_TOOL_COUNT).toBe(toolNames.length);
    // healthRoutes gates production readiness on MCP_TOOL_COUNT >= 29.
    expect(MCP_TOOL_COUNT).toBeGreaterThanOrEqual(29);
  });

  test('LISTED_SERVICE_COUNT source-of-truth is scripts/listing-services.json', () => {
    const listing = JSON.parse(
      readFileSync(repoPath('scripts/listing-services.json'), 'utf8')
    ) as unknown[];
    expect(Array.isArray(listing)).toBe(true);
    // CJK validator + judging pack both expect 17 listed services.
    expect(listing.length).toBe(17);

    // judgingPack.ts must derive the count from the file (no hardcoded literal
    // that can drift). Assert it reads the JSON and takes `.length`.
    const jp = readFileSync(repoPath('src/services/judgingPack.ts'), 'utf8');
    expect(jp).toContain('listing-services.json');
    expect(/readFileSync\(listingServicesPath[\s\S]*?\)\s*as unknown\[\]\s*\)\.length/.test(jp)).toBe(true);
  });
});
