import { createClient } from '@/lib/supabase/server';
import { generateReturningOpener } from '@/lib/product/opener';

export async function POST(): Promise<Response> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Get profile
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (!profile) {
    return Response.json({ opener: null });
  }

  // Count previous conversations
  const { count } = await supabase
    .from('conversations')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id);

  const conversationCount = count ?? 0;

  if (conversationCount === 0) {
    return Response.json({ opener: null }); // first-ever handled client-side
  }

  const opener = await generateReturningOpener(
    user.id,
    profile as Record<string, unknown>,
    conversationCount,
  );

  return Response.json({ opener });
}
