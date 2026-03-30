// Returns recent conversations for display on page load.

import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET(): Promise<Response> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return new Response('Unauthorized', { status: 401 });

  try {
    const { data } = await getSupabaseAdmin()
      .from('conversations')
      .select('id, started_at, messages, summary')
      .eq('user_id', user.id)
      .order('started_at', { ascending: false })
      .limit(20);

    // Get conversations with actual messages, up to 3
    const previous = (data || [])
      .filter(c => Array.isArray(c.messages) && (c.messages as unknown[]).length >= 2)
      .slice(0, 3)
      .reverse(); // oldest first

    if (previous.length === 0) {
      return Response.json({ conversations: [] });
    }

    return Response.json({
      conversations: previous.map(c => ({
        conversationId: c.id,
        startedAt: c.started_at,
        messages: c.messages,
        summary: c.summary,
      })),
    });
  } catch {
    return Response.json({ conversations: [] }, { status: 500 });
  }
}
