import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { ChatUI } from '@/components/chat-ui';

export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Check if this is a clone user
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('clone_source_user_id')
    .eq('user_id', user.id)
    .maybeSingle();

  const isClone = !!profile?.clone_source_user_id;

  return <ChatUI isClone={isClone} />;
}
