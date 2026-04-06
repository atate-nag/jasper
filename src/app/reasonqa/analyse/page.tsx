import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { UploadForm } from '@/components/reasonqa/upload-form';

export default async function AnalysePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-bold text-white">New Analysis</h1>
      <p className="mt-2 text-sm text-gray-400">
        Upload a professional document — legal brief, strategy memo, audit
        opinion, research report — and receive a structured reasoning quality
        analysis.
      </p>
      <div className="mt-8">
        <UploadForm />
      </div>
    </div>
  );
}
