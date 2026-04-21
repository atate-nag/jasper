export const dynamic = 'force-dynamic';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getSupabaseAdmin } from '@/lib/supabase';
import { AnalysisPoller } from '@/components/reasonqa/analysis-poller';
import { ReportTabs } from '@/components/reasonqa/report-tabs';
import type { Analysis, AnalysisStatus } from '@/lib/reasonqa/types';

export default async function AnalysisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { id } = await params;

  const { data, error } = await getSupabaseAdmin()
    .from('reasonqa_analyses')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (error || !data) {
    return (
      <div className="pt-16 text-center">
        <p className="text-[#8B8BA3]">Analysis not found.</p>
      </div>
    );
  }

  const analysis = data as Analysis;

  if (analysis.status !== 'complete' && analysis.status !== 'error') {
    // Detect mode: re-verify or dialectical
    const isReverify = !!analysis.pass1_output && !!analysis.pass2_output &&
      (analysis.status === 'pass3' || (analysis.title?.includes('re-verified') ?? false));
    const isDialectical = ['pass5', 'pass6', 'pass7', 'pass8', 'pass9'].includes(analysis.status);
    return (
      <AnalysisPoller
        id={id}
        initialStatus={analysis.status as AnalysisStatus}
        createdAt={analysis.created_at}
        initialStats={analysis.pass_stats}
        reverify={isReverify}
        dialectical={isDialectical}
        documentName={analysis.title || 'Untitled document'}
        docType={analysis.doc_type}
        mode={analysis.mode}
      />
    );
  }

  if (analysis.status === 'error') {
    return (
      <div className="pt-16 text-center">
        <p className="font-medium text-[#A63D40]">Analysis failed</p>
        <p className="mt-2 text-sm text-[#8B8BA3]">{analysis.error_message}</p>
      </div>
    );
  }

  // Fetch version siblings for the version switcher
  let versionSiblings: Array<{ id: string; version_number: number; analysis_type: string; created_at: string }> = [];
  if (analysis.version_group_id) {
    const { data: siblings } = await getSupabaseAdmin()
      .from('reasonqa_analyses')
      .select('id, version_number, analysis_type, created_at')
      .eq('version_group_id', analysis.version_group_id)
      .eq('status', 'complete')
      .order('version_number', { ascending: true });
    if (siblings && siblings.length > 1) {
      versionSiblings = siblings;
    }
  }

  return <ReportTabs analysis={analysis} versionSiblings={versionSiblings} />;
}
