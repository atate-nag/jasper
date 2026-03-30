// Thread detection: identifies coherent conversational threads
// from accumulated session data. Runs at session end behind feature flag.

import { getSupabaseAdmin } from '@/lib/supabase';
import { callModel } from '@/lib/model-client';
import { logUsage } from '@/lib/usage';
import { getModelRouting } from '@/lib/config/models';
import { isEnabled } from '@/lib/features';

interface ThreadCandidate {
  label: string;
  summary: string;
  open_questions: string[];
  last_position: string;
  confidence: number;
  session_ids?: string[];
}

interface ThreadUpdate {
  thread_id: string;
  new_summary?: string;
  new_last_position?: string;
  new_open_questions?: string[];
  status?: string;
}

interface DetectionResult {
  new_threads: ThreadCandidate[];
  updates: ThreadUpdate[];
  assign_current: string | null;
}

export async function detectThreadCandidates(
  userId: string,
  currentConversationId: string,
  currentSummary: string,
): Promise<void> {
  if (!isEnabled('threading')) return;

  const sb = getSupabaseAdmin();

  // Get recent summaries (last 10 sessions)
  const { data: recentSessions } = await sb
    .from('conversations')
    .select('id, summary, started_at, thread_id')
    .eq('user_id', userId)
    .not('summary', 'is', null)
    .order('started_at', { ascending: false })
    .limit(10);

  // Get existing threads
  const { data: existingThreads } = await sb
    .from('threads')
    .select('*')
    .eq('user_id', userId);

  const threadContext = existingThreads?.length
    ? existingThreads.map(t => `- "${t.label}" (${t.status}, confidence: ${t.detection_confidence}): ${t.summary}`).join('\n')
    : 'None yet.';

  const sessionContext = recentSessions
    ?.map(s => `[${s.started_at?.slice(0, 16)} | id=${s.id}${s.thread_id ? ' | thread=' + s.thread_id : ''}]\n${s.summary?.substring(0, 500)}`)
    .join('\n\n') || 'No sessions.';

  const prompt = `You are analysing conversation patterns to identify coherent threads — topics or lines of thinking that a user keeps returning to across multiple sessions.

EXISTING THREADS:
${threadContext}

RECENT SESSION SUMMARIES (newest first):
${sessionContext}

CURRENT SESSION SUMMARY:
${currentSummary}

Analyse these sessions. Look for:
1. Topics the user has returned to across 3+ sessions (not just mentioned — returned to with developing depth)
2. Lines of thinking that build on each other across sessions
3. Whether any existing threads should be updated or marked dormant

For each candidate thread:
- It must appear across at least 3 separate sessions
- It must show evidence of DEEPENING, not just repetition
- It should have unresolved questions or ongoing momentum

Return JSON:
{
  "new_threads": [
    {
      "label": "short descriptive label",
      "summary": "2-3 sentences describing the arc of this thread",
      "open_questions": ["what's unresolved"],
      "last_position": "where the thread currently sits",
      "confidence": 0.0-1.0,
      "session_ids": ["ids of conversations that belong to this thread"]
    }
  ],
  "updates": [
    {
      "thread_id": "existing thread id",
      "new_summary": "updated summary if the thread developed",
      "new_last_position": "where it sits now",
      "new_open_questions": ["updated"],
      "status": "active or dormant"
    }
  ],
  "assign_current": "thread_id or null — which existing or new thread does the current conversation belong to?"
}

If there are no new threads to create and no updates, return {"new_threads": [], "updates": [], "assign_current": null}.
Return raw JSON only.`;

  try {
    const routing = getModelRouting();
    const result = await callModel(
      routing.summary, // Opus
      '',
      [{ role: 'user', content: prompt }],
      0.3,
    );

    logUsage(result.usage, 'thread_detection', userId, currentConversationId);

    const cleaned = result.text
      .replace(/^\s*```(?:json)?\s*\n?/i, '')
      .replace(/\n?\s*```\s*$/i, '')
      .trim();

    const parsed = JSON.parse(cleaned) as DetectionResult;

    // Create new threads (only if confidence > 0.7)
    for (const thread of parsed.new_threads || []) {
      if (thread.confidence < 0.7) {
        console.log(`[threading] Skipping low-confidence thread "${thread.label}" (${thread.confidence})`);
        continue;
      }

      const { data: newThread } = await sb
        .from('threads')
        .insert({
          user_id: userId,
          label: thread.label,
          summary: thread.summary,
          open_questions: thread.open_questions,
          last_position: thread.last_position,
          detection_confidence: thread.confidence,
          detected_from_sessions: thread.session_ids?.length || 3,
          status: 'candidate',
        })
        .select()
        .single();

      if (newThread && thread.session_ids?.length) {
        await sb
          .from('conversations')
          .update({ thread_id: newThread.id })
          .in('id', thread.session_ids);

        // Also tag segments from those conversations
        await sb
          .from('conversation_segments')
          .update({ thread_id: newThread.id })
          .in('conversation_id', thread.session_ids);
      }

      console.log(`[threading] New thread: "${thread.label}" (confidence: ${thread.confidence}, sessions: ${thread.session_ids?.length || 0})`);
    }

    // Update existing threads
    for (const update of parsed.updates || []) {
      const updateData: Record<string, unknown> = {};
      if (update.new_summary) updateData.summary = update.new_summary;
      if (update.new_last_position) updateData.last_position = update.new_last_position;
      if (update.new_open_questions) updateData.open_questions = update.new_open_questions;
      if (update.status) {
        updateData.status = update.status;
        if (update.status === 'active') updateData.last_active_at = new Date().toISOString();
      }

      if (Object.keys(updateData).length > 0) {
        await sb
          .from('threads')
          .update(updateData)
          .eq('id', update.thread_id);
        console.log(`[threading] Updated thread ${update.thread_id.slice(0, 8)}: status=${update.status || 'unchanged'}`);
      }
    }

    // Assign current conversation to thread
    if (parsed.assign_current) {
      await sb
        .from('conversations')
        .update({ thread_id: parsed.assign_current })
        .eq('id', currentConversationId);

      // Also tag current conversation's segments
      await sb
        .from('conversation_segments')
        .update({ thread_id: parsed.assign_current })
        .eq('conversation_id', currentConversationId);

      // Update thread's last_active_at
      await sb
        .from('threads')
        .update({ last_active_at: new Date().toISOString() })
        .eq('id', parsed.assign_current);

      console.log(`[threading] Assigned current conversation to thread ${parsed.assign_current.slice(0, 8)}`);
    }

    const newCount = (parsed.new_threads || []).filter(t => t.confidence >= 0.7).length;
    const updateCount = (parsed.updates || []).length;
    console.log(`[threading] Detection complete: ${newCount} new, ${updateCount} updates`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[threading] Detection failed:', msg);
  }
}
