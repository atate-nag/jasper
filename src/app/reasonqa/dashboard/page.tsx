import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getSupabaseAdmin } from '@/lib/supabase';
import Link from 'next/link';
import { AnalysisList } from '@/components/reasonqa/analysis-list';

export default async function Dashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: analyses } = await getSupabaseAdmin()
    .from('reasonqa_analyses')
    .select('id, status, title, doc_type, created_at, completed_at, pass3_output')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  const rows = (analyses || []).map(a => ({
    id: a.id,
    status: a.status,
    title: a.title,
    docType: a.doc_type,
    doc_type: a.doc_type,
    created_at: a.created_at,
    quality: a.pass3_output?.assessment?.quality || null,
  }));

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-[#1A1A2E]" style={{ fontFamily: 'var(--font-serif)' }}>Your Analyses</h1>
        <Link
          href="/reasonqa/analyse"
          className="rounded bg-[#1B2A4A] px-4 py-2 text-sm font-medium text-white hover:bg-[#263D6A]"
        >
          New Analysis
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="mt-8 text-[#8B8BA3]">
          No analyses yet.{' '}
          <Link href="/reasonqa/analyse" className="text-[#1B2A4A] hover:underline">
            Upload a document
          </Link>{' '}
          to get started.
        </p>
      ) : (
        <AnalysisList analyses={rows} />
      )}
    </div>
  );
}
