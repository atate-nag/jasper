import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET(): Promise<Response> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from('reasonqa_analyses')
    .select('id, status, title, doc_type, created_at, completed_at, pass3_output')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    return Response.json({ error: 'Failed to fetch analyses' }, { status: 500 });
  }

  // Extract quality rating from pass3 output for list display
  const analyses = (data || []).map(a => ({
    id: a.id,
    status: a.status,
    title: a.title,
    docType: a.doc_type,
    createdAt: a.created_at,
    completedAt: a.completed_at,
    quality: a.pass3_output?.assessment?.quality || null,
  }));

  return Response.json({ analyses });
}
