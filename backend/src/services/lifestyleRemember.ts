import { PUBLIC_BASE_URL } from '../config/main-config.ts';
import { writeOne } from './memoryWriter.ts';
import { setMemoryPinned, whoAmI, type WhoAmIResult } from './memoryWhoami.ts';

// -----------------------------------------------------------------------------
// Lifestyle Remember — one-call Lifestyle Companion packet.
// Writes a preference/fact with lifestyle tags, pins it, returns whoami.
// Marketplace "Lifestyle Memory" service maps to this MCP tool.
// -----------------------------------------------------------------------------

export type LifestyleKind = 'preference' | 'fact' | 'goal';

export interface LifestyleRememberInput {
  identityAddress: string;
  content: string;
  kind?: LifestyleKind;
  pin?: boolean;
}

export interface LifestyleRememberResult {
  identity: string;
  memoryId: string;
  category: 'preference' | 'fact';
  tags: string[];
  pinned: boolean;
  whoami: WhoAmIResult;
  portraitUrl: string;
