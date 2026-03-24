import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function WelcomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Check if user has a profile, create one if not
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!profile) {
    await supabase.from('user_profiles').insert({
      user_id: user.id,
      identity: {},
      values: {},
      patterns: {},
      relationships: {},
      current_state: {},
      interaction_prefs: {},
    });
  }

  redirect('/');
}
