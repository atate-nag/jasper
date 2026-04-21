import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { parseDocument, validateDocument } from '@/lib/reasonqa/parser';
import { checkUsageLimit, isWithinRevisionWindow } from '@/lib/reasonqa/stripe';
import { inngest } from '@/lib/reasonqa/inngest';
import { computeTextSimilarity } from '@/lib/reasonqa/diff';
import { decryptText } from '@/lib/reasonqa/encryption';

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
    const parentAnalysisId = formData.get('parentAnalysisId') as string | null;

    // ── Incremental re-analysis path ──────────────────────────────
    if (parentAnalysisId && mode === 'full') {
      // Verify parent exists, belongs to user, and has encrypted doc text
      const { data: parent } = await getSupabaseAdmin()
        .from('reasonqa_analyses')
        .select('id, user_id, version_group_id, version_number, doc_text_encrypted')
        .eq('id', parentAnalysisId)
        .eq('user_id', user.id)
        .single();

      if (!parent || !parent.doc_text_encrypted) {
        return Response.json({ error: 'Parent analysis not found or document expired' }, { status: 400 });
      }

      // Free within 7-day revision window; costs a credit outside it
      const withinWindow = await isWithinRevisionWindow(parentAnalysisId);
      if (!withinWindow) {
        const { allowed, usage, limit, isPro } = await checkUsageLimit(user.id);
        if (!allowed) {
          return Response.json({
            error: isPro
              ? `Revision window expired and monthly limit reached (${usage}/${limit}).`
              : `Revision window expired and free tier limit reached (${usage}/${limit}).`,
            upgradeUrl: isPro ? undefined : '/reasonqa/pricing',
          }, { status: 403 });
        }
      }

      const { data, error } = await getSupabaseAdmin()
        .from('reasonqa_analyses')
        .insert({
          user_id: user.id,
          status: 'pending',
          title: file.name.replace(/\.[^.]+$/, ''),
          doc_type: docType,
          doc_text: text,
          doc_size_bytes: buffer.length,
          mode: 'full',
          dialectical: false,
          analysis_type: withinWindow ? 'incremental' : 'full',
          parent_analysis_id: parentAnalysisId,
          version_group_id: parent.version_group_id || parentAnalysisId,
          version_number: (parent.version_number || 1) + 1,
        })
        .select('id')
        .single();

      if (error || !data) {
        console.error('[reasonqa] Failed to create incremental analysis:', error?.message);
        return Response.json({ error: 'Failed to create analysis' }, { status: 500 });
      }

      await inngest.send({
        name: 'reasonqa/incremental',
        data: { analysisId: data.id, parentAnalysisId, userId: user.id },
      });

      return Response.json({ id: data.id });
    }

    // ── Revision detection (only for full mode, no explicit parent) ──
    if (mode === 'full' && !parentAnalysisId) {
      const candidates = await detectRevisionCandidates(user.id, text);
      if (candidates.length > 0) {
        return Response.json({ revisionDetected: true, candidates, documentText: undefined });
      }
    }

    // ── Standard new analysis path ────────────────────────────────
    const { allowed, usage, limit, isPro } = await checkUsageLimit(user.id);
    if (!allowed) {
      return Response.json({
        error: isPro
          ? `Monthly limit reached (${usage}/${limit}). Contact us for higher volume.`
          : `Free tier limit reached (${usage}/${limit}). Upgrade to Pro for 20 analyses/month.`,
        upgradeUrl: isPro ? undefined : '/reasonqa/pricing',
      }, { status: 403 });
    }

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
        analysis_type: mode === 'quick' ? 'quick' : 'full',
        version_group_id: null, // Set to own ID after insert
      })
      .select('id')
      .single();

    if (error || !data) {
      console.error('[reasonqa] Failed to create analysis:', error?.message);
      return Response.json({ error: 'Failed to create analysis' }, { status: 500 });
    }

    // Set version_group_id to own ID for new analyses
    await getSupabaseAdmin()
      .from('reasonqa_analyses')
      .update({ version_group_id: data.id })
      .eq('id', data.id);

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

// ── Revision Detection ──────────────────────────────────────────

interface RevisionCandidate {
  id: string;
  title: string;
  version: number;
  createdAt: string;
  similarity: number;
}

async function detectRevisionCandidates(
  userId: string,
  newText: string,
): Promise<RevisionCandidate[]> {
  // Get user's recent completed full analyses with non-expired encrypted doc text
  const { data: recent } = await getSupabaseAdmin()
    .from('reasonqa_analyses')
    .select('id, title, version_number, created_at, doc_text_encrypted, doc_text_enc_iv')
    .eq('user_id', userId)
    .eq('status', 'complete')
    .in('analysis_type', ['full', 'incremental'])
    .not('doc_text_encrypted', 'is', null)
    .gt('doc_text_expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(10);

  if (!recent || recent.length === 0) return [];

  const newOpening = newText.substring(0, 2000);
  const candidates: RevisionCandidate[] = [];

  for (const analysis of recent) {
    if (!analysis.doc_text_encrypted || !analysis.doc_text_enc_iv) continue;

    try {
      const parentText = decryptText(
        Buffer.from(analysis.doc_text_encrypted),
        Buffer.from(analysis.doc_text_enc_iv),
      );
      const parentOpening = parentText.substring(0, 2000);
      const similarity = computeTextSimilarity(newOpening, parentOpening);

      if (similarity > 0.6) {
        candidates.push({
          id: analysis.id,
          title: analysis.title || 'Untitled',
          version: analysis.version_number || 1,
          createdAt: analysis.created_at,
          similarity,
        });
      }
    } catch {
      // Decryption failed — skip this candidate
      continue;
    }
  }

  return candidates.sort((a, b) => b.similarity - a.similarity).slice(0, 3);
}
