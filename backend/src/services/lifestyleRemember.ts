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
  nextPrompts: string[];
}

const kindToCategory = (kind: LifestyleKind): 'preference' | 'fact' => {
  // Prisma/Zod have no "goal" enum — store goals as facts with lifestyle+goal tags.
  if (kind === 'preference') return 'preference';
  return 'fact';
};

export const lifestyleRemember = async (
  input: LifestyleRememberInput
): Promise<LifestyleRememberResult> => {
  const identity = input.identityAddress.toLowerCase();
  const kind: LifestyleKind = input.kind ?? 'preference';
  const category = kindToCategory(kind);
  const pin = input.pin !== false;

  const tags = ['lifestyle', kind, 'companion'];
  const written = await writeOne({
    identityAddress: identity,
    content: input.content.trim(),
    category,
    tags,
    metadata: { source: 'lifestyle_remember', kind },
    clientNonce: `lifestyle:${identity}:${Date.now()}`,
    paymentMode: 'free',
  });

  let pinned = false;
  let finalTags = tags;
  if (pin) {
    const pinResult = await setMemoryPinned(identity, written.memoryId, true);
    pinned = pinResult.pinned;
    finalTags = pinResult.tags;
  }

  const whoami = await whoAmI(identity);

  return {
    identity,
    memoryId: written.memoryId,
    category,
    tags: finalTags,
    pinned,
    whoami,
    portraitUrl: `${PUBLIC_BASE_URL}/portrait/${identity}.svg`,
    nextPrompts: [
      `Run memory_whoami for ${identity}`,
      `Ask AMBER: what lifestyle preferences do you remember about me?`,
      `Open ${PUBLIC_BASE_URL}/portrait/${identity}.svg`,
    ],
  };
};
