import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { parseDocument, validateDocument } from '@/lib/reasonqa/parser';
import { checkUsageLimit } from '@/lib/reasonqa/stripe';
import { inngest } from '@/lib/reasonqa/inngest';

const MIME_MAP: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'text/markdown': 'md',
};

export async function POST(req: Request): Promise<Response> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const { allowed, usage, limit, isPro } = await checkUsageLimit(user.id);
    if (!allowed) {
      return Response.json({
        error: isPro
          ? `Monthly limit reached (${usage}/${limit}). Contact us for higher volume.`
          : `Free tier limit reached (${usage}/${limit}). Upgrade to Pro for 20 analyses/month.`,
        upgradeUrl: isPro ? undefined : '/reasonqa/pricing',
      }, { status: 403 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return Response.json({ error: 'No file provided' }, { status: 400 });
    }

    const mimeType = file.type || 'text/plain';
    const docType = MIME_MAP[mimeType];
    if (!docType) {
      return Response.json({ error: `Unsupported file type: ${mimeType}` }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const text = await parseDocument(buffer, mimeType);

    const validation = validateDocument(text);
    if (!validation.valid) {
      return Response.json({ error: validation.error }, { status: 400 });
    }

    const mode = (formData.get('mode') as string) === 'quick' ? 'quick' : 'full';
    const dialectical = formData.get('dialectical') === 'true';

    const { data, error } = await getSupabaseAdmin()
      .from('reasonqa_analyses')
      .insert({
        user_id: user.id,
        status: 'pending',
        title: file.name.replace(/\.[^.]+$/, ''),
        doc_type: docType,
        doc_text: text,
        doc_size_bytes: buffer.length,
        mode,
        dialectical,
      })
      .select('id')
      .single();

    if (error || !data) {
      console.error('[reasonqa] Failed to create analysis:', error?.message);
      return Response.json({ error: 'Failed to create analysis' }, { status: 500 });
    }

    // Trigger Inngest background job
    await inngest.send({
      name: 'reasonqa/analyse',
      data: { analysisId: data.id, userId: user.id, mode, dialectical },
    });

    return Response.json({ id: data.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[reasonqa] Upload failed:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
