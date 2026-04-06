import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { id } = await params;

  const { data, error } = await getSupabaseAdmin()
    .from('reasonqa_analyses')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (error || !data) {
    return Response.json({ error: 'Analysis not found' }, { status: 404 });
  }

  return Response.json(data);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { id } = await params;
  const admin = getSupabaseAdmin();

  // Delete usage logs first (foreign key constraint)
  await admin
    .from('reasonqa_usage_log')
    .delete()
    .eq('analysis_id', id);

  // Delete the analysis
  const { error } = await admin
    .from('reasonqa_analyses')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) {
    console.error('[reasonqa] Delete failed:', error.message);
    return Response.json({ error: 'Failed to delete' }, { status: 500 });
  }

  return Response.json({ ok: true });
}
