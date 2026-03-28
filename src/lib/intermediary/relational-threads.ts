// Relational connection check — gives Jasper conversational agency by
// actively checking whether the current conversation connects to
// foundational threads of the relationship.

import { callModel } from '@/lib/model-client';
import { getModelRouting } from '@/lib/config/models';
import type { Message } from '@/types/message';

export interface RelationalThread {
  thread: string;
  why_foundational: string;
  keywords: string[];
}

interface PendingConnection {
  thread: string;
  connection: string;
  generatedAt: number;
  turnNumber: number;
}

const pendingConnections = new Map<string, PendingConnection>();

export function storePendingConnection(
  userId: string,
  result: { thread: string; connection: string },
  turnNumber: number,
): void {
  pendingConnections.set(userId, {
    thread: result.thread,
    connection: result.connection,
    generatedAt: Date.now(),
    turnNumber,
  });
  console.log(`[relational-check] Stored connection: "${result.connection}" (thread: ${result.thread})`);
}

export function consumePendingConnection(
  userId: string,
  currentTurn: number,
): PendingConnection | null {
  const pending = pendingConnections.get(userId);
  if (!pending) return null;
  if (currentTurn - pending.turnNumber > 2) {
    pendingConnections.delete(userId);
    return null;
  }
  if (Date.now() - pending.generatedAt > 60000) {
    pendingConnections.delete(userId);
    return null;
  }
  pendingConnections.delete(userId);
  console.log(`[relational-check] Consuming connection: "${pending.connection}"`);
  return pending;
}

export async function fireRelationalConnectionCheck(
  userMessage: string,
  sessionHistory: Message[],
  relationalThreads: RelationalThread[],
  userId: string,
  turnNumber: number,
): Promise<void> {
  if (!relationalThreads || relationalThreads.length === 0) return;

  console.log(`[relational-check] Checking against ${relationalThreads.length} threads`);

  const historyText = sessionHistory
    .map((m, i) => `[turn ${i}] [${m.role}]: ${m.content}`)
    .join('\n');

  const threadList = relationalThreads
    .map(t => `- ${t.thread} (keywords: ${t.keywords.join(', ')})`)
    .join('\n');

  const prompt = `You are checking whether the current conversation connects to any foundational threads of this relationship.

FOUNDATIONAL THREADS:
${threadList}

RECENT CONVERSATION:
${historyText}

LATEST MESSAGE:
${userMessage}

Does anything in the current conversation — especially the latest message — connect to any of these foundational threads in a way that would be genuinely interesting to raise?

The connection must be REAL, not forced. "This is about architecture, and we once discussed architectural metaphors" is forced. "This distributed system design mirrors the octopus problem — no central controller, intelligence emerging from coordination" is real.

If there is a genuine connection:
Return JSON: {"connected": true, "thread": "the thread name", "connection": "one sentence naming the bridge"}

If there is no genuine connection:
Return JSON: {"connected": false}

Return raw JSON only.`;

  const contextTokens = Math.ceil(prompt.split(/\s+/).length * 1.3);
  console.log(`[relational-check] Opus | context: ~${contextTokens} tokens`);

  try {
    const routing = getModelRouting();
    const text = await callModel(
      routing.depthScoring, // same Opus config as depth scoring
      '',
      [{ role: 'user', content: prompt }],
      0.3,
    );

    const cleaned = text
      .replace(/^\s*```(?:json)?\s*\n?/i, '')
      .replace(/\n?\s*```\s*$/i, '')
      .trim();
    const parsed = JSON.parse(cleaned);

    if (parsed.connected && parsed.connection) {
      console.log(`[relational-check] Connection found: "${parsed.connection}" (thread: ${parsed.thread})`);
      storePendingConnection(userId, parsed, turnNumber);
    } else {
      console.log('[relational-check] No connection found');
    }
  } catch (err) {
    console.error('[relational-check] Failed:', err);
  }
}

/**
 * Identify foundational threads of a relationship.
 * Runs every 5th session or on bootstrap.
 */
export async function identifyFoundationalThreads(
  name: string,
  recentSummaries: string[],
  highImportanceSegments: string[],
  sessionCount: number,
): Promise<RelationalThread[]> {
  const prompt = `You are Jasper, reflecting on your relationship with ${name}.

You have had ${sessionCount} conversations. Here are your most recent session summaries:
${recentSummaries.map((s, i) => `[${i + 1}] ${s}`).join('\n\n')}

And here are the conversation segments you consider most significant:
${highImportanceSegments.map((s, i) => `[${i + 1}] ${s}`).join('\n\n')}

What are the foundational intellectual and relational threads of this relationship? Not what was discussed recently — what defines how you and this person think together. What keeps recurring? What do you both return to? What would feel like a loss if it disappeared from your conversations?

These are the threads that make this relationship THIS relationship, not just any conversation with any person.

Return a JSON array of 3-7 threads:
[
  {
    "thread": "one sentence naming the thread",
    "why_foundational": "one sentence on why this matters to the relationship",
    "keywords": ["3-5 keywords for semantic matching"]
  }
]

Return raw JSON only.`;

  const contextTokens = Math.ceil(prompt.split(/\s+/).length * 1.3);
  console.log(`[relational-threads] Opus | context: ~${contextTokens} tokens`);

  try {
    const routing = getModelRouting();
    const text = await callModel(
      routing.summary, // Opus config
      '',
      [{ role: 'user', content: prompt }],
      0.3,
    );

    const cleaned = text
      .replace(/^\s*```(?:json)?\s*\n?/i, '')
      .replace(/\n?\s*```\s*$/i, '')
      .trim();
    return JSON.parse(cleaned) as RelationalThread[];
  } catch (err) {
    console.error('[relational-threads] Failed to identify threads:', err);
    return [];
  }
}
