// Pipeline execution endpoint. Runs one phase at a time based on current status.
// The poller calls this repeatedly — each call advances the pipeline one step.
// Each step fits within Vercel Pro's 300s maxDuration.

import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { runPipelinePhase } from '@/lib/reasonqa/pipeline';
import type { AnalysisMode } from '@/lib/reasonqa/types';

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
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (error || !data) {
    return Response.json({ error: 'Analysis not found' }, { status: 404 });
  }

  // Run the next phase based on current status
  const result = await runPipelinePhase(
    id,
    data,
    user.id,
    (data.mode || 'full') as AnalysisMode,
  );

  return Response.json(result);
}
