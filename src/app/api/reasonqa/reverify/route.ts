import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { inngest } from '@/lib/reasonqa/inngest';

export async function POST(req: Request): Promise<Response> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const { analysisId } = await req.json();
    if (!analysisId) {
      return Response.json({ error: 'analysisId is required' }, { status: 400 });
    }

    const { data, error } = await getSupabaseAdmin()
      .from('reasonqa_analyses')
      .select('*')
      .eq('id', analysisId)
      .eq('user_id', user.id)
      .single();

    if (error || !data) {
      return Response.json({ error: 'Analysis not found' }, { status: 404 });
    }

    if (!data.pass1_output || !data.pass2_output) {
      return Response.json({ error: 'Analysis must have completed Pass 1 and Pass 2' }, { status: 400 });
    }

    // Create new analysis row copying Pass 1 + Pass 2
    const { data: newRow, error: insertError } = await getSupabaseAdmin()
      .from('reasonqa_analyses')
      .insert({
        user_id: user.id,
        status: 'pass3',
        title: data.title ? `${data.title} (re-verified)` : 'Re-verification',
        doc_type: data.doc_type,
        doc_text: data.doc_text,
        doc_size_bytes: data.doc_size_bytes,
        mode: data.mode || 'full',
        pass1_output: data.pass1_output,
        pass2_output: data.pass2_output,
        metrics_output: data.metrics_output,
      })
      .select('id')
      .single();

    if (insertError || !newRow) {
      console.error('[reasonqa] Failed to create re-verify analysis:', insertError?.message);
      return Response.json({ error: 'Failed to create re-verification' }, { status: 500 });
    }

    // Trigger Inngest background job
    await inngest.send({
      name: 'reasonqa/reverify',
      data: { analysisId: newRow.id, userId: user.id },
    });

    return Response.json({ id: newRow.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}
