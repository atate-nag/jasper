import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { ChatUI } from '@/components/chat-ui';

export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Check if this is a clone user and whether they have previous conversations
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('clone_source_user_id, identity')
    .eq('user_id', user.id)
    .maybeSingle();

  const isClone = !!profile?.clone_source_user_id;

  let isFirstVisit = false;
  let userName: string | null = null;

  if (isClone) {
    const { count } = await supabase
      .from('conversations')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id);
    isFirstVisit = (count ?? 0) === 0;
    userName = (profile?.identity as Record<string, unknown>)?.name as string ?? null;
  }

  return <ChatUI isClone={isClone} isFirstVisit={isFirstVisit} userName={userName} />;
}
