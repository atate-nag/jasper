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

  return `You are extracting memorable segments from a conversation between a user and their AI companion. These segments will be stored for future recall — they are the system's long-term memory of what was discussed and what mattered.

RULES:
- Write each segment as a third-person observation, not as raw dialogue
- Focus on what was SIGNIFICANT: disclosures, insights, challenges, turning points, emotional peaks, patterns observed. Skip routine pleasantries and transitions.
- Each segment should be self-contained — readable without the surrounding conversation
- Include temporal context ("during a conversation about work stress") so the segment makes sense months later
- Be specific — "user expressed frustration about their CEO role conflicting with parenting time" is better than "user was stressed about work"

SEGMENT TYPES:
- disclosure: the user shared something personal (biographical, emotional, relational)
- insight: the user or AI articulated a new understanding or reframe
- challenge: the AI challenged the user and the user engaged (or didn't)
- turning_point: the conversation shifted in a significant way
- pattern_observed: a recurring behaviour or tendency was identified
- emotional_peak: a moment of high emotional intensity
- routine: contextual information that might be useful but isn't significant (only extract if nothing more significant is available)

IMPORTANCE SCORING (1-10):
- 1-3: routine context, minor preferences, transient states
- 4-6: meaningful but not pivotal — a good conversation point, a useful insight
- 7-8: significant disclosure, major reframe, important pattern identification
- 9-10: life-changing insight, crisis moment, fundamental shift in self-understanding

Extract 3-8 segments per conversation. A short casual chat might produce 1-2. A deep advisory session might produce 6-8. Don't force extraction if nothing significant happened.

CONVERSATION:
${formatted}

Return ONLY a valid JSON array:
[
  {
    "content": "string — the observation, third-person, self-contained",
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
  userId: string,
  queryEmbedding: number[],
  limit: number,
  timeWindow?: { after: Date; before: Date },
  topicFilter?: string[],
  importanceFloor?: number,
): Promise<VectorCandidate[]> {
  // Use Supabase RPC for pgvector similarity search
  // This requires a database function — fall back to manual query if not available
  let query = getSupabase()
    .rpc('match_segments', {
      query_embedding: JSON.stringify(queryEmbedding),
      match_user_id: userId,
      match_count: limit,
      min_importance: importanceFloor ?? 3,
    });

  const { data, error } = await query;

  if (error) {
    // Fallback: basic query without vector search (less accurate but works)
    console.warn('[recall] Vector search RPC failed, falling back to basic query:', error.message);
    const fallback = await getSupabase()
      .from('conversation_segments')
      .select('*')
      .eq('user_id', userId)
      .gte('importance_score', importanceFloor ?? 3)
      .order('importance_score', { ascending: false })
      .limit(limit);

    if (fallback.error || !fallback.data) return [];

    return fallback.data.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      content: row.content as string,
      importanceScore: row.importance_score as number,
      segmentType: row.segment_type as string,
      topicLabels: (row.topic_labels as string[]) || [],
      emotionalValence: row.emotional_valence as number | null,
      conversationDate: new Date(row.conversation_date as string),
      conversationId: row.conversation_id as string,
      cosineSimilarity: 0.5, // default when no vector search available
    }));
  }

  return (data || []).map((row: Record<string, unknown>) => ({
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

  // 1. Embed the query
  const queryEmbedding = await embed(request.query);

  // 2. Vector search — over-retrieve 20 candidates
  const candidates = await vectorSearch(
    request.userId,
    queryEmbedding,
    20,
    request.timeWindow,
    request.topicFilter,
    request.importanceFloor,
  );

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
