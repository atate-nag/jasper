// Serves the test library index.json for the analytics view.
// Also supports building the index from DB data.

import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { readFileSync, existsSync } from 'fs';

export async function GET(): Promise<Response> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Try file-based index first (from extract-comparison-stats.ts)
  const indexPath = 'scripts/test-library/index.json';
  if (existsSync(indexPath)) {
    const index = JSON.parse(readFileSync(indexPath, 'utf-8'));
    return Response.json({ cases: index, source: 'file' });
  }

  // Fall back to DB-based index
  const { data: analyses } = await getSupabaseAdmin()
    .from('reasonqa_analyses')
    .select('id, title, status, created_at, pass1_output, pass2_output, pass3_output, metrics_output, mode')
    .eq('user_id', user.id)
    .eq('status', 'complete')
    .order('created_at', { ascending: false })
    .limit(50);

  const cases = (analyses || []).map(a => {
    const p1 = a.pass1_output as { nodes?: unknown[] } | null;
    const p2 = a.pass2_output as { edges?: unknown[]; structuralIssues?: unknown[] } | null;
    const p3 = a.pass3_output as Record<string, unknown> | null;
    const assessment = p3?.assessment as Record<string, unknown> | null;
    const interpretive = p3?.interpretiveIssues as unknown[] | null;

    return {
      name: a.title || 'Untitled',
      id: a.id,
      quality: (assessment?.quality as string) || 'N/A',
      claims: (p1?.nodes?.length as number) || 0,
      edges: (p2?.edges?.length as number) || 0,
      structuralIssues: (p2?.structuralIssues?.length as number) || 0,
      interpretiveIssues: (interpretive?.length as number) || 0,
      mode: a.mode || 'full',
      createdAt: a.created_at,
      hasComparison: false,
      rating: 0,
      truePositives: 0,
      falseNegatives: 0,
      falsePositives: 0,
    };
  });

  return Response.json({ cases, source: 'db' });
}
