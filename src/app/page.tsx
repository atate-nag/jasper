import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { ChatUI } from '@/components/chat-ui';
import { OnboardingBrief } from '@/components/onboarding-brief';

export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Check onboarding status
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('onboarding_completed')
    .eq('user_id', user.id)
    .maybeSingle();

  const needsOnboarding = !profile?.onboarding_completed;

  if (needsOnboarding) {
    return <OnboardingBrief />;
  }

  return <ChatUI />;
}
