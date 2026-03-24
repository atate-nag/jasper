import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function WelcomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Check if user has a profile
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('id, calibration')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!profile) {
    // Create profile with default calibration
    const { defaultCalibration } = await import('@/lib/backbone/profile');
    await supabase.from('user_profiles').insert({
      user_id: user.id,
      identity: {},
      values: {},
      patterns: {},
      relationships: {},
      current_state: {},
      interaction_prefs: {},
      calibration: defaultCalibration(),
    });
  } else if (!profile.calibration) {
    // Existing profile without calibration — add defaults
    const { defaultCalibration } = await import('@/lib/backbone/profile');
    await supabase
      .from('user_profiles')
      .update({ calibration: defaultCalibration() })
      .eq('id', profile.id);
  }

  redirect('/');
}
