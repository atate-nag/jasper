// Run dialectical passes (5-9) on an existing completed analysis.
// Reuses Pass 1-4 data, adds Passes 5-9.

import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { inngest } from '@/lib/reasonqa/inngest';

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
    .select('user_id, status, pass1_output, pass4_output')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (error || !data) {
    return Response.json({ error: 'Analysis not found' }, { status: 404 });
  }

  if (!data.pass1_output || !data.pass4_output) {
    return Response.json({ error: 'Analysis must have completed Passes 1-4' }, { status: 400 });
  }

  // Mark as dialectical in-progress
  await getSupabaseAdmin()
    .from('reasonqa_analyses')
    .update({ dialectical: true, status: 'pass5' })
    .eq('id', id);

  await inngest.send({
    name: 'reasonqa/dialectical',
    data: { analysisId: id, userId: user.id },
  });

  return Response.json({ ok: true });
}
