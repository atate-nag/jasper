import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function WelcomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Create clone profile if no profile exists
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!profile) {
    const { createCloneProfile } = await import('@/lib/backbone/clone');
    await createCloneProfile(user.id);
  }

  redirect('/');
}
