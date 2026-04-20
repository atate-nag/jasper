import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { UploadForm } from '@/components/reasonqa/upload-form';

export default async function AnalysePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-semibold text-[#1A1A2E]" style={{ fontFamily: 'var(--font-serif)' }}>New Analysis</h1>
      <p className="mt-2 text-sm text-[#4A4A68]">
        Upload a professional document — legal brief, strategy memo, audit
        opinion, research report — and receive a structured reasoning quality
        analysis.
      </p>
      <div className="mt-6 rounded border border-[#E5E7EB] bg-[#FAFBFC] px-4 py-3 text-xs leading-relaxed text-[#4A4A68]">
        Your document is processed under zero data retention and deleted
        from our servers immediately after analysis. No data is used for
        model training.{' '}
        <a href="/reasonqa/security" className="text-[#1B2A4A] underline hover:text-[#263D6A]">
          Learn more
        </a>
      </div>
      <div className="mt-6">
        <UploadForm />
      </div>
    </div>
  );
}
