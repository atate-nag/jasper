// Returns the most recent ended conversation's messages for display.

import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET(): Promise<Response> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return new Response('Unauthorized', { status: 401 });

  try {
    // Get the most recent conversation with messages
    const { data } = await getSupabaseAdmin()
      .from('conversations')
      .select('id, started_at, messages, summary')
      .eq('user_id', user.id)
      .order('started_at', { ascending: false })
      .limit(5);

    // Find the most recent conversation that has actual messages
    const previous = (data || []).find(c =>
      Array.isArray(c.messages) && (c.messages as unknown[]).length >= 2
    );

    if (!previous) {
      return Response.json({ messages: [], summary: null });
    }

    return Response.json({
      conversationId: previous.id,
      startedAt: previous.started_at,
      messages: previous.messages,
      summary: previous.summary,
    });
  } catch {
    return Response.json({ messages: [] }, { status: 500 });
  }
}
