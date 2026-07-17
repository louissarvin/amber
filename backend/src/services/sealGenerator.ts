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
