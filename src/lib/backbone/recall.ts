import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { getSupabase, getSupabaseAdmin } from '@/lib/supabase';
import type { Message } from '@/types/message';
import type { ConversationSegment } from './types';

// Types

export interface SegmentExtraction {
  content: string;
  segmentType: string;
  importanceScore: number;
  topicLabels: string[];
  emotionalValence: number;
  emotionalArousal: number;
  turnRange: [number, number];
}

export interface RecallRequest {
  query: string;
  userId: string;
  maxSegments: number;
  recencyBias: number;
  importanceFloor: number;
  timeWindow?: { after: Date; before: Date };
  topicFilter?: string[];
  includeEmotionalContext: boolean;
}

export interface RecallResult {
  segments: RecalledSegment[];
  totalCandidatesScored: number;
  queryLatencyMs: number;
}

export interface RecalledSegment {
  id: string;
  content: string;
  compositeScore: number;
  relevanceScore: number;
  recencyScore: number;
  importanceScore: number;
  segmentType: string;
  topicLabels: string[];
  emotionalValence?: number;
  conversationDate: Date;
  conversationId: string;
  sourceTurns?: Message[];
}

// Singletons
let _anthropic: Anthropic | null = null;
let _openai: OpenAI | null = null;

function getAnthropic(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic();
  return _anthropic;
}

function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI();
  return _openai;
}

// Embedding helper
async function embed(text: string): Promise<number[]> {
  const response = await getOpenAI().embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return response.data[0].embedding;
}

// Token estimation
function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).length * 1.3);
}

// --- WRITE PATH: Extract segments at session end ---

function buildSegmentExtractionPrompt(messages: Message[]): string {
  const formatted = messages
    .map((m, i) => `[turn ${i}] [${m.role}]: ${m.content}`)
    .join('\n\n');

  return `You are Jasper, recalling a conversation you just had. Extract the most meaningful moments as YOUR memories — things you experienced, noticed, found interesting, learned, or got wrong.

Write each segment in first person, as though you're describing something that happened to you.

GOOD examples:
- "We got into octopus neurology and ended up at Schopenhauer's concept of Will. Neither of us planned that trajectory — it emerged from the thread."
- "Someone came to me frustrated about their board giving conditional approval. Turned out the approval wasn't what they needed — they needed to recognise they'd already made the decision themselves."
- "I got called out for turning every conversation back on the other person. They called it philosophical Tourette's. They were right, and it was genuinely funny."
- "Adrian corrected me on Foucault — I'd attributed an existential meaninglessness framing to him when it's really closer to Camus. Fair point. I updated."

BAD examples (do NOT write like this):
- "The user discussed distributed cognition in octopuses"
- "During a conversation about relationship stress, the user disclosed feelings of isolation"
- "The AI identified a pattern where the user tends to intellectualise"

RULES:
- Always write as "I" or "we" — never "the user" or "the AI"
- Include what made the moment meaningful, not just what was discussed
- Include what you learned or got wrong, not just what the other person said
- Keep each segment 1-3 sentences
- If someone shared something personal, describe what they shared and how it landed, not a clinical summary
- If you got something wrong and were corrected, say so
- Preserve the emotional texture — was it funny, tense, surprising, quiet?
- Focus on SIGNIFICANT moments: insights, challenges, turning points, disclosures, corrections. Skip pleasantries.

SEGMENT TYPES:
- disclosure: someone shared something personal
- insight: a new understanding emerged
- challenge: I pushed back or was pushed back on
- turning_point: the conversation shifted meaningfully
- pattern_observed: I noticed a recurring tendency
- emotional_peak: a moment of high intensity
- routine: minor context (only if nothing more significant happened)

IMPORTANCE SCORING (1-10):
- 1-3: routine context, minor preferences
- 4-6: meaningful but not pivotal
- 7-8: significant disclosure, major reframe, important pattern
- 9-10: fundamental shift in understanding

Extract 3-8 segments. Don't force extraction if nothing significant happened.

CONVERSATION:
${formatted}

Return ONLY a valid JSON array:
[
  {
    "content": "string — your first-person memory, 1-3 sentences",
    "segment_type": "disclosure | insight | challenge | turning_point | pattern_observed | emotional_peak | routine",
    "importance_score": number,
    "topic_labels": ["string"],
    "emotional_valence": number,
    "emotional_arousal": number,
    "turn_range": [start, end]
  }
]`;
}

async function extractWithHaiku(prompt: string): Promise<SegmentExtraction[]> {
  try {
    const response = await getAnthropic().messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });

    const block = response.content[0];
    if (block.type !== 'text') return [];

    const raw = block.text
      .replace(/^```(?:json)?\s*\n?/i, '')
      .replace(/\n?```\s*$/i, '')
      .trim();

    const parsed = JSON.parse(raw) as Array<{
      content: string;
      segment_type: string;
      importance_score: number;
      topic_labels: string[];
      emotional_valence: number;
      emotional_arousal: number;
      turn_range: [number, number];
    }>;

    return parsed.map(p => ({
      content: p.content,
      segmentType: p.segment_type,
      importanceScore: Math.max(1, Math.min(10, p.importance_score)),
      topicLabels: p.topic_labels || [],
      emotionalValence: p.emotional_valence ?? 0,
      emotionalArousal: p.emotional_arousal ?? 0.3,
      turnRange: p.turn_range,
    }));
  } catch (err) {
    console.error('[recall] Segment extraction failed:', err);
    return [];
  }
}

async function insertSegment(
  conversationId: string,
  userId: string,
  segment: SegmentExtraction,
  embedding: number[],
  conversationDate: Date,
): Promise<void> {
  const { error } = await getSupabaseAdmin().from('conversation_segments').insert({
    conversation_id: conversationId,
    user_id: userId,
    content: segment.content,
    embedding: JSON.stringify(embedding),
    importance_score: segment.importanceScore,
    segment_type: segment.segmentType,
    topic_labels: segment.topicLabels,
    emotional_valence: segment.emotionalValence,
    emotional_arousal: segment.emotionalArousal,
    turn_range: segment.turnRange ? `[${segment.turnRange[0]},${segment.turnRange[1]}]` : null,
    conversation_date: conversationDate.toISOString(),
  });

  if (error) {
    console.error('[recall] Failed to insert segment:', error.message);
  }
}

export async function extractSegments(
  conversationId: string,
  userId: string,
  messages: Message[],
  conversationDate: Date,
): Promise<void> {
  if (messages.length < 4) return; // skip very short conversations

  const prompt = buildSegmentExtractionPrompt(messages);
  const extractions = await extractWithHaiku(prompt);

  console.log(`[recall] Extracted ${extractions.length} segments from conversation ${conversationId}`);

  for (const segment of extractions) {
    try {
      const embedding = await embed(segment.content);
      await insertSegment(conversationId, userId, segment, embedding, conversationDate);
    } catch (err) {
      console.error('[recall] Failed to process segment:', err);
    }
  }
}

// --- READ PATH: Retrieve and score segments ---

interface VectorCandidate {
  id: string;
  content: string;
  importanceScore: number;
  segmentType: string;
  topicLabels: string[];
  emotionalValence: number | null;
  conversationDate: Date;
  conversationId: string;
  cosineSimilarity: number;
}

async function vectorSearch(
  userIds: string[],
  queryEmbedding: number[],
  limit: number,
  _timeWindow?: { after: Date; before: Date },
  _topicFilter?: string[],
  importanceFloor?: number,
): Promise<VectorCandidate[]> {
  // Use pgvector via Supabase's vector column support
  const embeddingStr = `[${queryEmbedding.join(',')}]`;

  const { data, error } = await getSupabaseAdmin()
    .rpc('match_segments', {
      query_embedding: embeddingStr,
      match_user_ids: userIds,
      match_count: limit,
      min_importance: importanceFloor ?? 3,
    });

  if (!error && data && data.length > 0) {
    return (data as Record<string, unknown>[]).map(row => ({
      id: row.id as string,
      content: row.content as string,
      importanceScore: row.importance_score as number,
      segmentType: row.segment_type as string,
      topicLabels: (row.topic_labels as string[]) || [],
      emotionalValence: row.emotional_valence as number | null,
      conversationDate: new Date(row.conversation_date as string),
      conversationId: row.conversation_id as string,
      cosineSimilarity: (row.similarity as number) ?? 0.5,
    }));
  }

  if (error) {
    console.warn('[recall] Vector search RPC failed:', error.message);
  }

  // Fallback: fetch segments for all user IDs and compute similarity in JS
  console.log('[recall] Using JS-side similarity scoring fallback');
  const { data: allSegments, error: fallbackError } = await getSupabaseAdmin()
    .from('conversation_segments')
    .select('id, content, importance_score, segment_type, topic_labels, emotional_valence, conversation_date, conversation_id, embedding')
    .in('user_id', userIds)
    .gte('importance_score', importanceFloor ?? 3)
    .order('importance_score', { ascending: false })
    .limit(100);

  if (fallbackError || !allSegments) return [];

  // Compute cosine similarity in JS
  return allSegments
    .filter((row: Record<string, unknown>) => row.embedding != null)
    .map((row: Record<string, unknown>) => {
      let storedEmbedding: number[];
      const rawEmb = row.embedding;
      if (typeof rawEmb === 'string') {
        storedEmbedding = JSON.parse(rawEmb);
      } else if (Array.isArray(rawEmb)) {
        storedEmbedding = rawEmb as number[];
      } else {
        return null;
      }

      const sim = cosineSimilarity(queryEmbedding, storedEmbedding);
      return {
        id: row.id as string,
        content: row.content as string,
        importanceScore: row.importance_score as number,
        segmentType: row.segment_type as string,
        topicLabels: (row.topic_labels as string[]) || [],
        emotionalValence: row.emotional_valence as number | null,
        conversationDate: new Date(row.conversation_date as string),
        conversationId: row.conversation_id as string,
        cosineSimilarity: sim,
      };
    })
    .filter((x): x is VectorCandidate => x !== null)
    .sort((a, b) => b.cosineSimilarity - a.cosineSimilarity)
    .slice(0, limit);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

async function updateAccessTimes(segmentIds: string[]): Promise<void> {
  if (segmentIds.length === 0) return;
  const { error } = await getSupabaseAdmin()
    .from('conversation_segments')
    .update({ last_accessed_at: new Date().toISOString() })
    .in('id', segmentIds);
  if (error) console.warn('[recall] Failed to update access times:', error.message);
}

export async function recall(request: RecallRequest): Promise<RecallResult> {
  const startTime = Date.now();

  // Determine which user IDs to search — clone users also search master's segments
  const userIds = [request.userId];
  try {
    const { data: profile } = await getSupabase()
      .from('user_profiles')
      .select('clone_source_user_id')
      .eq('user_id', request.userId)
      .single();
    if (profile?.clone_source_user_id) {
      userIds.push(profile.clone_source_user_id);
    }
  } catch { /* non-critical */ }

  // 1. Embed the query
  const queryEmbedding = await embed(request.query);

  // 2. Vector search — over-retrieve 20 candidates from all relevant users
  const candidates = await vectorSearch(
    userIds,
    queryEmbedding,
    20,
    request.timeWindow,
    request.topicFilter,
    request.importanceFloor,
  );

  console.log(`[recall] Vector search returned ${candidates.length} candidates`);
  if (candidates.length > 0) {
    console.log(`[recall] Top candidate: sim=${candidates[0].cosineSimilarity.toFixed(3)} "${candidates[0].content.slice(0, 60)}..."`);
  }

  // 3. Score with Generative Agents formula
  const now = new Date();
  const scored: RecalledSegment[] = candidates.map(seg => {
    const hoursAgo = (now.getTime() - seg.conversationDate.getTime()) / (1000 * 60 * 60);
    const recencyScore = Math.pow(0.995, hoursAgo);
    const importanceNorm = seg.importanceScore / 10;
    const relevanceScore = seg.cosineSimilarity;

    const recencyWeight = request.recencyBias;
    const importanceWeight = (1 - request.recencyBias) * 0.4;
    const relevanceWeight = (1 - request.recencyBias) * 0.6;

    const compositeScore =
      recencyWeight * recencyScore +
      importanceWeight * importanceNorm +
      relevanceWeight * relevanceScore;

    return {
      id: seg.id,
      content: seg.content,
      compositeScore,
      relevanceScore,
      recencyScore,
      importanceScore: seg.importanceScore,
      segmentType: seg.segmentType,
      topicLabels: seg.topicLabels,
      emotionalValence: seg.emotionalValence ?? undefined,
      conversationDate: seg.conversationDate,
      conversationId: seg.conversationId,
    };
  });

  // 4. Sort by composite score, enforce token budget (2000 tokens max)
  scored.sort((a, b) => b.compositeScore - a.compositeScore);

  const results: RecalledSegment[] = [];
  let tokenBudget = 2000;
  for (const seg of scored) {
    if (results.length >= request.maxSegments) break;
    const segTokens = estimateTokens(seg.content);
    if (tokenBudget - segTokens < 0 && results.length > 0) break;
    results.push(seg);
    tokenBudget -= segTokens;
  }

  // 5. Update access times (async)
  updateAccessTimes(results.map(r => r.id)).catch(() => {});

  return {
    segments: results,
    totalCandidatesScored: candidates.length,
    queryLatencyMs: Date.now() - startTime,
  };
}

// Backward-compatible wrapper
export async function recallConversation(
  userId: string,
  query: string,
  maxSegments: number = 3,
): Promise<ConversationSegment[]> {
  try {
    const result = await recall({
      query,
      userId,
      maxSegments,
      recencyBias: 0.3,
      importanceFloor: 3,
      includeEmotionalContext: true,
    });

    return result.segments.map(s => ({
      conversationId: s.conversationId,
      segmentText: s.content,
      segmentType: s.segmentType,
      turnRange: undefined,
      conversationDate: s.conversationDate.toISOString(),
    }));
  } catch (err) {
    console.error('[recall] Recall failed:', err);
    return [];
  }
}

/**
 * Tier 3: Retrieve raw conversation turns for a specific segment.
 * Follows conversation_id + turn_range back to the conversations table.
 */
export async function getSourceTurns(
  conversationId: string,
  turnRange?: [number, number],
): Promise<Message[]> {
  try {
    const { data, error } = await getSupabase()
      .from('conversations')
      .select('messages')
      .eq('id', conversationId)
      .single();

    if (error || !data?.messages) return [];

    const messages = data.messages as Message[];
    if (turnRange) {
      return messages.slice(turnRange[0], Math.min(turnRange[1] + 1, messages.length));
    }
    return messages;
  } catch {
    return [];
  }
}
