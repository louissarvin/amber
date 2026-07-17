import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prismaQuery } from '../lib/prisma.ts';
import { getOrCreateIdentity } from './identity.ts';
import { ASSETS_DIR, PUBLIC_BASE_URL } from '../config/main-config.ts';

// -----------------------------------------------------------------------------
// SEALSCRIBE-lite — SVG decree generator (no LLM, no resvg).
// Caller supplies subject + decree text. We render a brand-true amber seal SVG,
// persist the Seal row, and enqueue no attestation link until a later pass
// (attestationId stays null — decree is the shareable artifact).
// -----------------------------------------------------------------------------

export type SigilStyle = 'amber' | 'onyx' | 'cream';

const STYLE_FILL: Record<SigilStyle, { ink: string; wax: string; cream: string }> = {
  amber: { ink: '#0A0A0A', wax: '#E4A853', cream: '#FBF7ED' },
  onyx: { ink: '#0A0A0A', wax: '#3A3A3A', cream: '#FBF7ED' },
  cream: { ink: '#0A0A0A', wax: '#F5CB5C', cream: '#FBF7ED' },
};

const escapeXml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const wrapLines = (text: string, maxChars: number, maxLines: number): string[] => {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars) {
      cur = next;
    } else {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length >= maxLines) break;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (words.join(' ').length > lines.join(' ').length) {
    const last = lines[lines.length - 1] ?? '';
    lines[lines.length - 1] = `${last.slice(0, Math.max(0, maxChars - 1))}…`;
  }
  return lines;
};

export const renderSealSvg = (input: {
  subject: string;
  decreeText: string;
  sigilStyle: SigilStyle;
  identity: string;
  sealId: string;
}): string => {
  const colors = STYLE_FILL[input.sigilStyle];
  const subject = escapeXml(input.subject.slice(0, 80));
  const bodyLines = wrapLines(input.decreeText, 42, 8).map(escapeXml);
  const shortId = escapeXml(input.identity.slice(0, 10) + '…' + input.identity.slice(-4));
  const bodyTspans = bodyLines
    .map(
      (line, i) =>
        `<tspan x="400" dy="${i === 0 ? 0 : 28}">${line}</tspan>`
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000">
  <rect width="800" height="1000" fill="${colors.ink}"/>
  <rect x="40" y="40" width="720" height="920" fill="none" stroke="${colors.wax}" stroke-width="3"/>
  <rect x="56" y="56" width="688" height="888" fill="none" stroke="${colors.wax}" stroke-width="1" opacity="0.5"/>
  <text x="400" y="120" text-anchor="middle" font-family="Georgia, serif" font-size="28" letter-spacing="6" fill="${colors.wax}">AMBER DECREE</text>
  <text x="400" y="180" text-anchor="middle" font-family="Georgia, serif" font-size="36" font-weight="600" fill="${colors.cream}">${subject}</text>
  <line x1="200" y1="210" x2="600" y2="210" stroke="${colors.wax}" stroke-width="1" opacity="0.6"/>
  <text x="400" y="280" text-anchor="middle" font-family="Georgia, serif" font-size="20" fill="${colors.cream}" opacity="0.9">${bodyTspans}</text>
  <circle cx="400" cy="780" r="90" fill="${colors.wax}" opacity="0.95"/>
  <circle cx="400" cy="780" r="72" fill="none" stroke="${colors.ink}" stroke-width="3"/>
  <text x="400" y="788" text-anchor="middle" font-family="Inter, Helvetica, sans-serif" font-size="22" font-weight="500" letter-spacing="4" fill="${colors.ink}">AMBER</text>
  <text x="400" y="900" text-anchor="middle" font-family="ui-monospace, monospace" font-size="14" fill="${colors.cream}" opacity="0.45">${shortId}</text>
  <text x="400" y="930" text-anchor="middle" font-family="ui-monospace, monospace" font-size="12" fill="${colors.wax}" opacity="0.5">${escapeXml(input.sealId)}</text>
</svg>`;
};

export interface GenerateSealInput {
  identityAddress: string;
  subject: string;
  decreeText: string;
  sigilStyle?: SigilStyle;
}

export interface GenerateSealResult {
  sealId: string;
  subject: string;
  sigilStyle: SigilStyle;
  svgUrl: string;
  svgPath: string;
  createdAt: string;
}

export const generateSeal = async (input: GenerateSealInput): Promise<GenerateSealResult> => {
  const identity = await getOrCreateIdentity(input.identityAddress);
  const sigilStyle: SigilStyle = input.sigilStyle ?? 'amber';
  const subject = input.subject.trim().slice(0, 120);
  const decreeText = input.decreeText.trim().slice(0, 2000);
  if (!subject || !decreeText) {
    const err = new Error('subject and decreeText are required') as Error & { code: string };
    err.code = 'BAD_INPUT';
    throw err;
  }

  const sealId = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
  const relDir = path.join('seals', identity.address.slice(2, 10));
  const absDir = path.join(ASSETS_DIR, relDir);
  await fs.mkdir(absDir, { recursive: true });
  const fileName = `${sealId}.svg`;
  const absPath = path.join(absDir, fileName);
  const relPath = path.join(relDir, fileName);

  const svg = renderSealSvg({
    subject,
    decreeText,
    sigilStyle,
    identity: identity.address,
    sealId,
  });
  await fs.writeFile(absPath, svg, 'utf8');

  const row = await prismaQuery.seal.create({
    data: {
      id: sealId,
      identityId: identity.id,
      subject,
      decreeText,
      sigilStyle,
      svgPath: relPath,
      pngPath: null,
    },
  });

  return {
    sealId: row.id,
    subject: row.subject,
    sigilStyle,
    svgUrl: `${PUBLIC_BASE_URL}/seal/${row.id}.svg`,
    svgPath: row.svgPath,
    createdAt: row.createdAt.toISOString(),
  };
};

export const getSealById = async (sealId: string) => {
  return prismaQuery.seal.findFirst({
    where: { id: sealId, deletedAt: null },
    include: { identity: { select: { address: true } } },
  });
};

export const readSealSvg = async (sealId: string): Promise<string | null> => {
  const seal = await getSealById(sealId);
  if (!seal) return null;
  const abs = path.join(ASSETS_DIR, seal.svgPath);
  try {
    return await fs.readFile(abs, 'utf8');
  } catch {
    return null;
  }
};
