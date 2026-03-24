// Session-end calibration: reads turn data from the just-completed session,
// computes signal counts, updates Beta distributions in the profile.

import { getSupabaseAdmin } from '@/lib/supabase';
import type { Message } from '@/types/message';
import type { CalibrationParameters } from './types';

interface SessionSignals {
  humourInstances: number;
  challengeEngaged: number;
  challengeDeflected: number;
  correctionsGiven: number;
  unpromptedDisclosures: number;
  turnCount: number;
  endedGracefully: boolean;
  dominantRegister: string;
}

/**
 * Extract calibration signals from a completed session's messages.
 * Lightweight heuristic analysis — not LLM-powered.
 */
export function extractSessionSignals(messages: Message[]): SessionSignals {
  let humourInstances = 0;
  let challengeEngaged = 0;
  let challengeDeflected = 0;
  let correctionsGiven = 0;
  let unpromptedDisclosures = 0;

  const userMessages = messages.filter(m => m.role === 'user');
  const assistantMessages = messages.filter(m => m.role === 'assistant');

  for (let i = 0; i < userMessages.length; i++) {
    const msg = userMessages[i].content.toLowerCase();

    // Humour detection (lightweight)
    if (/\b(haha|lol|lmao|😂|🤣|joke|kidding|tongue.in.cheek)\b/i.test(msg) ||
        /[.!]\s*[;:]-?\)/i.test(msg)) {
      humourInstances++;
    }

    // Correction detection
    if (/\b(actually|no[,.]|that's (not|wrong)|you're (wrong|off|mistaken)|i (meant|mean)|let me clarify)\b/i.test(msg)) {
      correctionsGiven++;
    }

    // Unprompted disclosure (personal info without being asked)
    if (i > 0) { // skip first message
      const prevAssistant = assistantMessages[i - 1]?.content.toLowerCase() || '';
      const hasQuestion = prevAssistant.includes('?');
      const hasPersonalContent = /\b(i feel|i think|my (wife|husband|partner|kid|son|daughter|family|boss)|i've been|i'm (worried|stressed|happy|tired|frustrated))\b/i.test(msg);
      if (hasPersonalContent && !hasQuestion) {
        unpromptedDisclosures++;
      }
    }

    // Challenge response (did they engage or deflect after an assistant observation?)
    if (i > 0) {
      const prevAssistant = assistantMessages[i - 1]?.content.toLowerCase() || '';
      const wasChallenge = /\b(i notice|pattern|you tend to|have you considered|the tension|what if)\b/i.test(prevAssistant);
      if (wasChallenge) {
        const engaged = msg.length > 50 && !/\b(anyway|let's move on|change the subject|something else)\b/i.test(msg);
        if (engaged) challengeEngaged++;
        else challengeDeflected++;
      }
    }
  }

  // Dominant register (simple heuristic based on message characteristics)
  const avgLength = userMessages.reduce((sum, m) => sum + m.content.length, 0) / (userMessages.length || 1);
  const dominantRegister = avgLength > 200 ? 'analytical' :
    humourInstances > 2 ? 'playful' :
    unpromptedDisclosures > 1 ? 'warm_reflective' : 'connecting';

  return {
    humourInstances,
    challengeEngaged,
    challengeDeflected,
    correctionsGiven,
    unpromptedDisclosures,
    turnCount: userMessages.length,
    endedGracefully: true, // caller sets this based on how session ended
    dominantRegister,
  };
}

/**
 * Update Beta distribution parameters based on session signals.
 * Each signal shifts the distribution — positive signals increase alpha,
 * resistance signals increase beta.
 */
export function updateCalibration(
  current: CalibrationParameters,
  signals: SessionSignals,
): CalibrationParameters {
  const updated = { ...current };

  // Challenge tolerance: engaged increases alpha, deflected increases beta
  updated.challengeAlpha += signals.challengeEngaged;
  updated.challengeBeta += signals.challengeDeflected;
  updated.challengeCeiling = updated.challengeAlpha / (updated.challengeAlpha + updated.challengeBeta);

  // Humour tolerance: instances increase alpha
  if (signals.humourInstances > 0) {
    updated.humourAlpha += Math.min(signals.humourInstances, 3); // cap per session
  } else {
    updated.humourBeta += 0.5; // slight shift toward caution if no humour at all
  }
  updated.humourTolerance = updated.humourAlpha / (updated.humourAlpha + updated.humourBeta);

  // Directness: corrections signal comfort with directness
  if (signals.correctionsGiven > 0) {
    updated.directnessAlpha += signals.correctionsGiven;
  }
  updated.directnessPreference = updated.directnessAlpha / (updated.directnessAlpha + updated.directnessBeta);

  // Disclosure comfort: unprompted disclosures increase alpha
  if (signals.unpromptedDisclosures > 0) {
    updated.disclosureAlpha += signals.unpromptedDisclosures;
  } else {
    updated.disclosureBeta += 0.5;
  }
  updated.disclosureComfort = updated.disclosureAlpha / (updated.disclosureAlpha + updated.disclosureBeta);

  // Warmth need: inversely related to challenge tolerance and directness
  // Users who welcome challenge and are direct need less warmth scaffolding
  updated.warmthNeed = updated.warmthAlpha / (updated.warmthAlpha + updated.warmthBeta);

  // Preferred register: track which register was dominant
  updated.preferredRegister = signals.dominantRegister;

  return updated;
}

/**
 * Persist calibration parameters to the user's profile.
 */
export async function saveCalibration(
  userId: string,
  calibration: CalibrationParameters,
): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('user_profiles')
    .update({ calibration })
    .eq('user_id', userId);

  if (error) {
    console.error('[calibrate] Failed to save calibration:', error.message);
  }
}
