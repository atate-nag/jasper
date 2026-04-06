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
        <p className="text-gray-500">Analysis not found.</p>
      </div>
    );
  }

  const analysis = data as Analysis;

  if (analysis.status !== 'complete' && analysis.status !== 'error') {
    // Detect re-verify: has Pass 1 + Pass 2 but status is pass3 (skipped earlier passes)
    const isReverify = !!analysis.pass1_output && !!analysis.pass2_output &&
      (analysis.status === 'pass3' || (analysis.title?.includes('re-verified') ?? false));
    return (
      <AnalysisPoller
        id={id}
        initialStatus={analysis.status as AnalysisStatus}
        createdAt={analysis.created_at}
        initialStats={analysis.pass_stats}
        reverify={isReverify}
      />
    );
  }

  if (analysis.status === 'error') {
    return (
      <div className="pt-16 text-center">
        <p className="text-red-400">Analysis failed</p>
        <p className="mt-2 text-sm text-gray-500">{analysis.error_message}</p>
      </div>
    );
  }

  return <ReportTabs analysis={analysis} />;
}
