import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { runReverify } from '@/lib/reasonqa/pipeline';

export const maxDuration = 300;

export async function POST(
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
    .select('user_id, doc_text, pass1_output, pass2_output, metrics_output, status')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (error || !data) {
    return Response.json({ error: 'Analysis not found' }, { status: 404 });
  }

  if (!data.pass1_output || !data.pass2_output) {
    return Response.json({ error: 'Missing pass data' }, { status: 400 });
  }

  await runReverify(id, data.doc_text, user.id, data.pass1_output, data.pass2_output, data.metrics_output);

  return Response.json({ ok: true });
}
