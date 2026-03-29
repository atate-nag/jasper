// Cron endpoint: finds stale conversations and runs session-end processing.
// Vercel cron hits this every 5 minutes. The in-memory timer approach
// doesn't work on serverless because function instances die between requests.

import { getSupabaseAdmin } from '@/lib/supabase';
import { runSessionEnd } from '@/lib/post-response';
import type { Message } from '@/types/message';

const STALE_MINUTES = 5;

export const maxDuration = 300; // 5 min — session-end runs Opus calls

export async function GET(req: Request): Promise<Response> {
  // Verify cron secret to prevent unauthorized access
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const cutoff = new Date(Date.now() - STALE_MINUTES * 60 * 1000).toISOString();

  try {
    // Find conversations that:
    // 1. Have no ended_at (not yet processed)
    // 2. Have messages (not empty shells)
    // 3. Were started more than STALE_MINUTES ago
    // We check started_at as a baseline — the actual staleness check uses
    // the last message timestamp from the messages JSON.
    const { data: staleConvos, error } = await getSupabaseAdmin()
      .from('conversations')
      .select('id, user_id, started_at, messages')
      .is('ended_at', null)
      .lt('started_at', cutoff)
      .order('started_at', { ascending: true });

    if (error) {
      console.error('[cron/session-end] Query error:', error.message);
      return Response.json({ error: error.message }, { status: 500 });
    }

    if (!staleConvos || staleConvos.length === 0) {
      return Response.json({ processed: 0 });
    }

    // Filter to conversations with actual messages and check last message time
    const toProcess = staleConvos.filter(conv => {
      const messages = conv.messages as Message[] | null;
      if (!messages || messages.length < 4) return false;

      // Check if the last message is old enough
      const lastMsg = messages[messages.length - 1];
      if (!lastMsg.timestamp) return true; // no timestamp = assume stale
      return new Date(lastMsg.timestamp).getTime() < Date.now() - STALE_MINUTES * 60 * 1000;
    });

    console.log(`[cron/session-end] Found ${staleConvos.length} unended conversations, ${toProcess.length} are stale`);

    let processed = 0;
    const results: Array<{ conversationId: string; userId: string; status: string }> = [];

    // Process sequentially to avoid overwhelming Opus with parallel calls
    for (const conv of toProcess) {
      const messages = conv.messages as Message[];
      try {
        console.log(`[cron/session-end] Processing conv ${conv.id.slice(0, 8)} for user ${conv.user_id.slice(0, 8)} (${messages.length} messages)`);
        await runSessionEnd(conv.user_id, conv.id, messages, 'cron');
        processed++;
        results.push({ conversationId: conv.id.slice(0, 8), userId: conv.user_id.slice(0, 8), status: 'ok' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[cron/session-end] Failed for conv ${conv.id.slice(0, 8)}:`, msg);
        results.push({ conversationId: conv.id.slice(0, 8), userId: conv.user_id.slice(0, 8), status: `error: ${msg}` });
      }
    }

    console.log(`[cron/session-end] Done: ${processed}/${toProcess.length} processed`);
    return Response.json({ processed, total: toProcess.length, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cron/session-end] Fatal:', msg);
    return Response.json({ error: msg }, { status: 500 });
  }
}
