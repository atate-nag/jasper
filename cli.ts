import { config } from 'dotenv';
config({ path: '.env.local' });
import * as readline from 'readline';
import { execSync } from 'child_process';

// Backbone
import {
  getProfile,
  mergeProfileUpdates,
  removeResolvedConcerns,
  createConversation,
  saveMessages,
  endConversation,
  getRecentConversations,
  getPersonContext,
} from './src/lib/backbone';
import { classifyConversation } from './src/lib/backbone/classify';
import { summariseConversation } from './src/lib/backbone/summarise';
// Memory is dynamically imported — mem0ai has many optional peer deps
async function getMemoryModule() {
  return import('./src/lib/backbone/memory');
}
import type { UserProfile, PersonContext, ConversationSummary } from './src/lib/backbone/types';
import type { Message } from './src/types/message';

// Intermediary
import { steer } from './src/lib/intermediary';
import type { ResponseDirective, SteeringResult, ConversationState } from './src/lib/intermediary/types';

// Product
import { JASPER } from './src/lib/product/identity';
import { detectActivity, type Activity } from './src/lib/product/activities/index';
import { recordUntilEnter } from './src/lib/product/voice/recorder';
import { transcribe } from './src/lib/product/voice/stt';
import { createSpeechStream } from './src/lib/product/voice/stream-speak';

// LLM
import { chatStream } from './src/lib/llm/client';

function isValidSpeech(transcription: string): boolean {
  const cleaned = transcription
    .replace(/[.\s,!?;:\-–—…'"()[\]{}]/g, '')
    .trim();
  return cleaned.length >= 3;
}

// --- State ---
const USER_ID = process.env.JASPER_USER_ID || '3a1272b1-577c-42a4-801e-e952fed68971';
const history: Message[] = [];
let profile: UserProfile;
let conversationId: string | null = null;
let recentConversations: ConversationSummary[] = [];
let observeMode: false | 'compact' | 'verbose' = false;
let voiceEnabled = process.argv.includes('--voice');
let voiceListening = false;
let activeActivity: Activity | null = null;
const activityHistory: Message[] = [];
let previousDirective: ResponseDirective | undefined;
let previousConversationState: ConversationState | undefined;

const supabaseReady = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// --- Helpers ---

function bareProfile(): UserProfile {
  return {
    id: '', user_id: USER_ID,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    identity: {}, values: {}, patterns: {}, relationships: {},
    current_state: {}, interaction_prefs: {},
  };
}

async function loadProfile(): Promise<UserProfile> {
  if (supabaseReady) {
    try {
      const p = await getProfile(USER_ID);
      if (p) { console.log('  profile loaded from Supabase'); return p; }
    } catch { console.log('  Supabase unavailable, using bare profile'); }
  }
  return bareProfile();
}

async function loadRecentConversations(): Promise<ConversationSummary[]> {
  if (!supabaseReady) return [];
  try {
    const convos = await getRecentConversations(USER_ID, 15);
    if (convos.length > 0) console.log(`  ${convos.length} previous conversation(s) loaded`);
    return convos.map(c => ({ id: c.id, summary: c.summary, started_at: c.started_at, ended_at: c.ended_at }));
  } catch { return []; }
}

async function startConversation(): Promise<void> {
  if (!supabaseReady) return;
  try {
    conversationId = await createConversation(USER_ID);
  } catch {}
}

async function persistMessages(): Promise<void> {
  if (!supabaseReady || !conversationId || history.length === 0) return;
  try { await saveMessages(conversationId, history); } catch {}
}

function observe(label: string, content: string): void {
  if (!observeMode) return;
  if (observeMode === 'verbose') {
    const dim = '\x1b[2m';
    const yellow = '\x1b[33m';
    const reset = '\x1b[0m';
    const sep = `${dim}${'─'.repeat(60)}${reset}`;
    console.log(sep);
    console.log(`${yellow}[${label}]${reset}`);
    console.log(`${dim}${content}${reset}`);
    console.log(sep);
  }
  // compact mode is handled separately in handleMessage
}

// --- Message handling ---

async function handleMessage(input: string): Promise<string> {
  // Activity check
  if (activeActivity) {
    const wantsToStop = /\b(stop|quit|end|done|enough|had enough|no more|back to normal)\b/i.test(input);
    if (wantsToStop) {
      activeActivity = null;
      activityHistory.length = 0;
      observe('ACTIVITY ENDED', 'User ended activity');
    } else {
      const specificActivity = detectActivity(input);
      if (specificActivity && specificActivity.id !== activeActivity.id) {
        activeActivity = specificActivity;
        return handleActivity(input, specificActivity);
      }
      return handleActivity(input, activeActivity);
    }
  }
  const isDismissing = /\b(enough|no more|stop|had enough|done with)\b/i.test(input);
  const activity = isDismissing ? null : detectActivity(input);
  if (activity) {
    activeActivity = activity;
    activityHistory.length = 0;
    return handleActivity(input, activity);
  }

  // Build person context
  const personContext = await getPersonContext(USER_ID, input, history);

  // Steer
  const steering = await steer(input, personContext, JASPER, history, previousDirective, previousConversationState);
  previousDirective = steering.responseDirective;
  previousConversationState = steering.conversationState;

  // Observe output
  if (observeMode === 'compact') {
    const d = steering.responseDirective;
    const dim = '\x1b[2m';
    const yellow = '\x1b[33m';
    const cyan = '\x1b[36m';
    const reset = '\x1b[0m';
    console.log(`${yellow}[CLASSIFICATION]${reset} intent: ${d.communicativeIntent} | valence: ${d.emotionalValence} | arousal: ${d.emotionalArousal} | posture: ${d.recommendedPostureClass} | length: ${d.recommendedResponseLength} | challenge: ${d.challengeAppropriate ? 'yes' : 'no'} | dispreferred: ${d.dispreferred ? 'yes' : 'no'} | conf: ${d.confidence}`);
    console.log(`  ${dim}→ "${d.rationale.substring(0, 120)}${d.rationale.length > 120 ? '...' : ''}"${reset}`);
    console.log(`${yellow}[POLICY]${reset} ${steering.selectedPolicy.id}`);
    console.log(`${yellow}[MODEL]${reset} ${steering.modelConfig.model} (${steering.modelConfig.tier}) temp: ${steering.modelConfig.temperature} max: ${steering.modelConfig.maxTokens}`);
    if (steering.recallTriggered) {
      console.log(`${yellow}[RECALL]${reset} ${d.recallTier}: "${d.recallQuery || 'none'}"`);
    } else {
      console.log(`${yellow}[RECALL]${reset} none`);
    }
    // Calibration state
    const cal = personContext.calibration;
    if (cal?.challengeCeiling != null) {
      const depth = personContext.relationshipMeta.conversationCount <= 1 ? 'first_encounter' :
        personContext.relationshipMeta.conversationCount <= 5 ? 'early' :
        personContext.relationshipMeta.conversationCount <= 15 ? 'developing' : 'established';
      console.log(`${yellow}[CALIBRATION]${reset} depth: ${depth} | challenge: ${cal.challengeCeiling.toFixed(2)} | humour: ${cal.humourTolerance.toFixed(2)} | directness: ${cal.directnessPreference.toFixed(2)}`);
    }
    // Self-observations
    if (personContext.selfObservations && personContext.selfObservations.length > 0) {
      const uninjected = personContext.selfObservations.filter(o => !o.injected);
      if (uninjected.length > 0) {
        const notes = uninjected.flatMap(o => o.patternsNoted);
        console.log(`${yellow}[METACOG]${reset} ${notes.length} self-obs: ${notes.map(n => n.metaheuristic).join(', ')}`);
      }
    }
    // Conversation state
    if (steering.conversationState) {
      const cs = steering.conversationState;
      const threads = cs.activeThreads.map((t: { topic: string; depthLevel: string; turnCount: number }) => `${t.topic.slice(0, 30)}(${t.depthLevel}, ${t.turnCount}t)`).join(' | ');
      if (cs.conversationDevelopmentMode) {
        console.log(`${yellow}[CONVERSATION]${reset} mode: development (turn ${cs.turnsInMode}, entered: ${cs.entryReason})`);
      } else {
        console.log(`${yellow}[CONVERSATION]${reset} mode: user-centric`);
      }
      if (threads) console.log(`  threads: ${threads} | energy: ${cs.energyTrajectory}`);
    }
    console.log('');
  } else if (observeMode === 'verbose') {
    observe('CLASSIFICATION', JSON.stringify(steering.responseDirective, null, 2));
    observe('POLICY', `${steering.selectedPolicy.id} (${steering.selectedPolicy.name})`);
    observe('MODEL', `TIER: ${steering.modelConfig.tier}\n${steering.modelConfig.provider}/${steering.modelConfig.model} (temp: ${steering.modelConfig.temperature}, max: ${steering.modelConfig.maxTokens})`);
    observe('SYSTEM PROMPT', steering.systemPrompt);
    observe('REFORMULATED', steering.reformulatedMessage);
    if (steering.recallTriggered) {
      observe('RECALL', `Tier: ${steering.responseDirective.recallTier}\nQuery: ${steering.responseDirective.recallQuery}\nSignals: ${steering.responseDirective.recallSignals?.join(', ') || 'none'}`);
    }
  }

  // Stream response
  const speechStream = voiceEnabled ? createSpeechStream() : null;

  const showOutput = !observeMode || observeMode === 'compact';
  if (showOutput) process.stdout.write('\n\x1b[32mai:\x1b[0m ');
  const reply = await chatStream(
    steering.modelConfig,
    steering.systemPrompt,
    steering.reformulatedMessage,
    steering.responseDirective.communicativeIntent === 'connecting' ? [] : history,
    (token) => {
      if (showOutput) process.stdout.write(token);
      if (speechStream) speechStream.push(token);
    },
  );
  if (showOutput) process.stdout.write('\n');

  if (speechStream) {
    speechStream.end();
    process.stdout.write('\x1b[2m\u{1F50A} Speaking...\x1b[0m\n');
    await speechStream.done();
  }

  observe('LLM RESPONSE', reply);

  // Update history
  const now = new Date().toISOString();
  history.push({ role: 'user', content: input, timestamp: now });
  history.push({ role: 'assistant', content: reply, timestamp: now, metadata: { policy: steering.selectedPolicy.id } });

  persistMessages();

  // Post-response actions
  if (steering.postResponseActions.classifyProfile) {
    classifyConversation(history, profile).then(async (result) => {
      if (result.profileUpdates && Object.keys(result.profileUpdates).length > 0) {
        if (supabaseReady) await mergeProfileUpdates(USER_ID, result.profileUpdates);
        const updates = result.profileUpdates as Record<string, Record<string, unknown>>;
        for (const key of Object.keys(updates)) {
          if (updates[key] && typeof updates[key] === 'object') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (profile as any)[key] = { ...(profile as any)[key], ...updates[key] };
          }
        }
        const fields = Object.keys(result.profileUpdates).filter(k => {
          const v = (result.profileUpdates as Record<string, unknown>)[k];
          return v && typeof v === 'object' && Object.keys(v as object).length > 0;
        });
        if (fields.length > 0) console.log(`  \x1b[33m[profile updated: ${fields.join(', ')}]\x1b[0m`);
      }
      if (result.resolvedConcerns?.length > 0 && supabaseReady) {
        await removeResolvedConcerns(USER_ID, result.resolvedConcerns);
        console.log(`  \x1b[33m[resolved: ${result.resolvedConcerns.length} concern(s)]\x1b[0m`);
      }
    }).catch(() => {});
  }

  if (steering.postResponseActions.extractMemories) {
    getMemoryModule().then(({ addToMemory }) => {
      addToMemory(
        USER_ID,
        [{ role: 'user', content: input }, { role: 'assistant', content: reply }],
      ).catch(() => {});
    }).catch(() => {});
  }

  return reply;
}

async function handleActivity(input: string, activity: Activity): Promise<string> {
  observe('ACTIVITY', `${activity.name} (${activity.id})`);

  const personalContext = `\n\nAbout this person (for personalisation only):
${profile.identity?.occupation || ''}, ${profile.identity?.living_situation || ''},
interests: ${(profile.values?.core_values as string[])?.join(', ') || 'unknown'}`;

  const systemPrompt = `${JASPER.identityPrompt}\n\n${activity.system_prompt_override}${personalContext}`;
  const tierConfig = {
    tier: activity.max_tier as 'ambient' | 'standard' | 'deep',
    provider: 'anthropic' as const,
    model: activity.max_tier === 'ambient' ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6',
    temperature: 0.9,
    maxTokens: activity.max_tier === 'ambient' ? 256 : 1024,
  };

  const speechStream = voiceEnabled ? createSpeechStream() : null;

  const showActivityOutput = !observeMode || observeMode === 'compact';
  if (showActivityOutput) process.stdout.write('\n\x1b[32mai:\x1b[0m ');
  const reply = await chatStream(
    tierConfig, systemPrompt, input, activityHistory,
    (token) => {
      if (showActivityOutput) process.stdout.write(token);
      if (speechStream) speechStream.push(token);
    },
  );
  if (showActivityOutput) process.stdout.write('\n');

  if (speechStream) {
    speechStream.end();
    process.stdout.write('\x1b[2m\u{1F50A} Speaking...\x1b[0m\n');
    await speechStream.done();
  }

  const now = new Date().toISOString();
  activityHistory.push({ role: 'user', content: input, timestamp: now });
  activityHistory.push({ role: 'assistant', content: reply, timestamp: now });
  history.push({ role: 'user', content: input, timestamp: now });
  history.push({ role: 'assistant', content: reply, timestamp: now });
  persistMessages();

  return reply;
}

// --- Shutdown ---

async function shutdown(): Promise<void> {
  if (history.length === 0) {
    console.log('\n  goodbye.\n');
    process.exit(0);
  }

  console.log('\n  saving conversation...');

  try {
    const summary = await summariseConversation(history);

    const hasAdvisoryContent = history.some(m => m.role === 'user' && !detectActivity(m.content));

    if (hasAdvisoryContent) {
      try {
        const result = await classifyConversation(history, profile);
        if (result.profileUpdates && Object.keys(result.profileUpdates).length > 0) {
          if (supabaseReady) await mergeProfileUpdates(USER_ID, result.profileUpdates);
        }
        if (result.resolvedConcerns?.length > 0 && supabaseReady) {
          await removeResolvedConcerns(USER_ID, result.resolvedConcerns);
          console.log(`  resolved: ${result.resolvedConcerns.length} concern(s)`);
        }
        // Extract conversation segments for deep recall
        try {
          const { extractSegments } = await import('./src/lib/backbone/recall');
          await extractSegments(conversationId!, USER_ID, history, new Date());
          console.log('  segments extracted for deep recall');
        } catch (err) {
          console.error('  segment extraction failed:', err instanceof Error ? err.message : err);
        }

        // Calibrate interaction parameters based on session signals
        try {
          const { extractSessionSignals, updateCalibration, saveCalibration } = await import('./src/lib/backbone/calibrate');
          const { getProfile } = await import('./src/lib/backbone/profile');
          const { defaultCalibration } = await import('./src/lib/backbone/profile');
          const currentProfile = await getProfile(USER_ID);
          const currentCal = (currentProfile as any)?.calibration || defaultCalibration();
          const signals = extractSessionSignals(history);
          const updatedCal = updateCalibration(currentCal, signals);
          await saveCalibration(USER_ID, updatedCal);
          console.log(`  calibration updated: challenge=${updatedCal.challengeCeiling.toFixed(2)} humour=${updatedCal.humourTolerance.toFixed(2)} directness=${updatedCal.directnessPreference.toFixed(2)}`);
        } catch (err) {
          console.error('  calibration update failed:', err instanceof Error ? err.message : err);
        }

        // Metacognitive evaluation
        try {
          const { runSessionMetacognition } = await import('./src/lib/backbone/metacognition');
          const obs = await runSessionMetacognition(USER_ID, conversationId!, history);
          if (obs) {
            console.log(`  metacognition: ${obs.patternsNoted.length} pattern(s) noted`);
            for (const p of obs.patternsNoted) {
              console.log(`    [${p.severity}] ${p.metaheuristic}: ${p.observation.slice(0, 100)}`);
            }
          }
        } catch (err) {
          console.error('  metacognition failed:', err instanceof Error ? err.message : err);
        }

        if (supabaseReady && conversationId) {
          await endConversation(conversationId, result.classification, summary);
        }
      } catch {
        if (supabaseReady && conversationId) {
          await endConversation(conversationId, { topics: [], emotional_tone: 'neutral' }, summary);
        }
      }
    } else if (supabaseReady && conversationId) {
      await endConversation(conversationId, { topics: [], emotional_tone: 'positive' }, summary);
    }

    console.log(`  summary: ${summary}`);
    console.log('  goodbye.\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  error during shutdown: ${msg}`);
    console.log('  goodbye.\n');
  }

  process.exit(0);
}

// --- Voice ---

async function voiceListenLoop(): Promise<void> {
  if (!voiceEnabled || voiceListening) return;

  voiceListening = true;
  process.stdout.write('\n\x1b[35m\u{1F3A4} Listening... (press Enter when done)\x1b[0m\n');

  try {
    const audioPath = await recordUntilEnter(120);
    process.stdout.write('\x1b[2m\u23F3 Transcribing...\x1b[0m ');
    const text = await transcribe(audioPath);

    if (!text || !isValidSpeech(text)) {
      console.log('[no speech detected]');
      voiceListening = false;
      if (voiceEnabled) setTimeout(() => voiceListenLoop(), 300);
      return;
    }

    console.log(`\n\x1b[36myou (voice):\x1b[0m ${text}`);

    try {
      await handleMessage(text);
      console.log();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n\x1b[31merror:\x1b[0m ${msg}\n`);
    }
  } catch (err) {
    console.error(`  [voice] ${(err as Error).message}`);
  }

  voiceListening = false;
  if (voiceEnabled) setTimeout(() => voiceListenLoop(), 1500);
}

// --- Main ---

async function main(): Promise<void> {
  console.log('\n  Jasper v2 — CLI\n');

  profile = await loadProfile();
  recentConversations = await loadRecentConversations();
  await startConversation();

  console.log('\n  Type your message and press Enter.');
  console.log('  Commands: /profile  /memories  /history  /observe  /voice  /clear  /quit\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  let shuttingDown = false;
  const gracefulShutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    rl.close();
    shutdown();
  };

  rl.on('close', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);

  const prompt = (): void => {
    rl.question('\x1b[36myou:\x1b[0m ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed) return prompt();

      if (trimmed === '/quit' || trimmed === '/exit') { rl.close(); return; }

      if (trimmed === '/profile') {
        console.log('\n\x1b[33m[profile]\x1b[0m');
        console.log(JSON.stringify(profile, null, 2));
        console.log();
        return prompt();
      }

      if (trimmed === '/history') {
        console.log('\n\x1b[33m[history]\x1b[0m');
        for (const m of history) {
          const label = m.role === 'user' ? '\x1b[36myou\x1b[0m' : '\x1b[32mai\x1b[0m';
          console.log(`${label}: ${m.content.slice(0, 120)}${m.content.length > 120 ? '...' : ''}`);
        }
        if (history.length === 0) console.log('  (empty)');
        console.log();
        return prompt();
      }

      if (trimmed === '/observe' || trimmed === '/observe compact' || trimmed === '/observe full' || trimmed === '/observe verbose' || trimmed === '/observe off') {
        if (trimmed === '/observe off') {
          observeMode = false;
        } else if (trimmed === '/observe full' || trimmed === '/observe verbose') {
          observeMode = 'verbose';
        } else {
          observeMode = observeMode ? false : 'compact';
        }
        console.log(`  observe mode: ${observeMode || 'OFF'}\n`);
        return prompt();
      }

      if (trimmed === '/memories') {
        console.log('\n\x1b[33m[mem0 memories]\x1b[0m');
        try {
          const { getAllMemories } = await getMemoryModule();
          const memories = await getAllMemories(USER_ID);
          if (memories.length === 0) console.log('  (no memories stored yet)');
          else {
            for (const m of memories) console.log(`  - ${m.memory}`);
            console.log(`\n  total: ${memories.length} memories`);
          }
        } catch (err) {
          console.log(`  (mem0 unavailable: ${err instanceof Error ? err.message : err})`);
        }
        console.log();
        return prompt();
      }

      if (trimmed === '/voice' || trimmed === '/voice on' || trimmed === '/voice off') {
        if (!process.env.OPENAI_API_KEY) {
          console.log('  [voice] OPENAI_API_KEY not set — voice unavailable\n');
          return prompt();
        }
        try { execSync('which rec', { stdio: 'ignore' }); } catch {
          console.log('  [voice] sox not found. Install: brew install sox\n');
          return prompt();
        }
        if (trimmed === '/voice off') voiceEnabled = false;
        else if (trimmed === '/voice on') voiceEnabled = true;
        else voiceEnabled = !voiceEnabled;
        console.log(`  [voice] Voice mode ${voiceEnabled ? 'enabled' : 'disabled'}`);
        if (voiceEnabled) {
          console.log('  [voice] Using OpenAI tts-1 (onyx) + Whisper');
          console.log('  [voice] Speak naturally — press Enter when done\n');
          voiceListenLoop();
        } else console.log();
        return prompt();
      }

      if (trimmed === '/clear') {
        history.length = 0;
        console.log('  history cleared.\n');
        return prompt();
      }

      try {
        await handleMessage(trimmed);
        console.log();
        if (voiceEnabled) setTimeout(() => voiceListenLoop(), 1500);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`\n\x1b[31merror:\x1b[0m ${msg}\n`);
      }

      prompt();
    });
  };

  prompt();

  if (voiceEnabled) {
    if (!process.env.OPENAI_API_KEY) {
      console.log('  [voice] OPENAI_API_KEY not set — voice disabled\n');
      voiceEnabled = false;
    } else {
      try {
        execSync('which rec', { stdio: 'ignore' });
        console.log('  [voice] Voice mode active. Speak naturally, press Enter when done.\n');
        voiceListenLoop();
      } catch {
        console.log('  [voice] sox not found. Install: brew install sox\n');
        voiceEnabled = false;
      }
    }
  }
}

main();
