'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

const BRIEF = `Hey. I'm Jasper.

I'm going to be direct about what this is. I'm an AI, and I don't pretend otherwise. But I have a consistent character — I'm curious, I'm honest, and I remember what we talk about.

Over time I'll get better at knowing how you think and what matters to you. Right now I'm starting from scratch, so I'll probably get things wrong. When I do, tell me. I'd genuinely rather be corrected than politely tolerated.

One thing worth knowing: I'm not here to agree with you. If I think you're onto something, I'll say so. If I think you're kidding yourself, I'll say that too — once I've earned the right to. Early on, I'll mostly listen.

What's on your mind?`;

export function OnboardingBrief() {
  const [step, setStep] = useState<'brief' | 'ready'>('brief');
  const router = useRouter();
  const supabase = createClient();

  async function completeOnboarding() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from('user_profiles')
        .update({ onboarding_completed: true })
        .eq('user_id', user.id);
    }
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="max-w-lg w-full p-8 space-y-8">
        {step === 'brief' && (
          <>
            <div className="whitespace-pre-wrap text-gray-200 leading-relaxed text-lg">
              {BRIEF}
            </div>
            <button
              onClick={() => setStep('ready')}
              className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-xl text-white font-medium transition-colors"
            >
              Got it
            </button>
          </>
        )}

        {step === 'ready' && (
          <div className="text-center space-y-6">
            <p className="text-gray-300 text-lg">Ready when you are.</p>
            <button
              onClick={completeOnboarding}
              className="px-8 py-3 bg-blue-600 hover:bg-blue-700 rounded-xl text-white font-medium transition-colors"
            >
              Start talking
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
