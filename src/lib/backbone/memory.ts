import { Memory } from 'mem0ai/oss';

// ---------------------------------------------------------------------------
// Mem0 client — singleton with custom extraction prompt
// ---------------------------------------------------------------------------

const CUSTOM_PROMPT = `You are a Personal Knowledge Extractor for a long-term AI companion.
Your job is to extract DURABLE FACTS about the user — things that are likely still true weeks or months from now.

EXTRACT:
- Identity facts (name, age, location, occupation, family structure)
- Stable preferences (communication style, values, interests)
- Relationship facts (partner's name, children's ages, key people)
- Recurring patterns (habits, routines, coping mechanisms)
- Long-term goals and aspirations
- Health conditions or ongoing situations

DO NOT EXTRACT:
- Momentary emotions ("I'm feeling stressed today")
- Transient tasks ("I need to buy groceries")
- Conversational filler ("that's interesting", "I see")
- Opinions about current events
- Anything already captured in previous memories

Format each memory as a clear, standalone fact about the user.`;

let _mem0: InstanceType<typeof Memory> | null = null;

function getMem0(): InstanceType<typeof Memory> {
  if (!_mem0) {
    _mem0 = new Memory({
      embedder: {
        provider: 'openai',
        config: {
          model: 'text-embedding-3-small',
        },
      },
      vectorStore: {
        provider: 'memory', // in-memory for now; swap to qdrant/supabase later
        config: {
          collectionName: 'jasper_memories',
        },
      },
      historyStore: {
        provider: 'memory',
        config: {},
      },
      customPrompt: CUSTOM_PROMPT,
    });
  }
  return _mem0;
}

// ---------------------------------------------------------------------------
// searchMemories — query mem0 with relevance threshold
// ---------------------------------------------------------------------------

export interface MemoryResult {
  id?: string;
  memory: string;
  score?: number;
}

export async function searchMemories(
  userId: string,
  query: string,
  limit: number = 10,
): Promise<MemoryResult[]> {
  try {
    const mem0 = getMem0();
    const results = await mem0.search(query, {
      userId,
      limit,
    });

    // Filter by relevance threshold
    const filtered = (results?.results ?? results ?? [])
      .filter((r: { score?: number }) => (r.score ?? 0) > 0.3)
      .map((r: { id?: string; memory?: string; score?: number }) => ({
        id: r.id,
        memory: r.memory ?? '',
        score: r.score,
      }));

    return filtered;
  } catch (err) {
    console.error('[memory] Search error:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// addToMemory — add messages to mem0, suppressing internal errors
// ---------------------------------------------------------------------------

export async function addToMemory(
  userId: string,
  messages: { role: string; content: string }[],
): Promise<void> {
  try {
    const mem0 = getMem0();
    await mem0.add(messages, {
      userId,
    });
  } catch (err) {
    // Suppress mem0 internal errors — non-critical path
    console.warn('[memory] Add error (suppressed):', err);
  }
}

// ---------------------------------------------------------------------------
// getAllMemories — retrieve all stored memories for a user
// ---------------------------------------------------------------------------

export async function getAllMemories(
  userId: string,
): Promise<MemoryResult[]> {
  try {
    const mem0 = getMem0();
    const results = await mem0.getAll({
      userId,
    });

    return (results?.results ?? results ?? []).map(
      (r: { id?: string; memory?: string; score?: number }) => ({
        id: r.id,
        memory: r.memory ?? '',
        score: r.score,
      }),
    );
  } catch (err) {
    console.error('[memory] GetAll error:', err);
    return [];
  }
}
