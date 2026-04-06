# Staging Environment + Threading — CC Briefing

## Part 1: Dev/Staging Environment

We need to be able to build and test features without them hitting live users. This is now blocking — threading is needed but can't be deployed untested.

### Setup

**Option A: Vercel Preview Deployments (quickest)**

Every branch push to a non-main branch gets a preview URL automatically on Vercel. Use this as staging.

```
main branch     → chatwithj.online (production, live users)
dev branch      → [auto-generated].vercel.app (staging, dev only)
```

The staging deployment needs its own environment:

```
SUPABASE_URL            → same (shared database)
SUPABASE_SERVICE_ROLE   → same
NEXT_PUBLIC_SUPABASE_*  → same
ANTHROPIC_API_KEY       → same
OPENAI_API_KEY          → same
FEATURE_FLAGS           → {"threading": true, "newFeature": true}
```

Shared database is fine — staging users (Adrian, test accounts) and production users coexist. Feature flags gate what code paths execute.

**Feature flag implementation:**

```typescript
// lib/features.ts
const FLAGS = JSON.parse(process.env.FEATURE_FLAGS || '{}');

export function isEnabled(feature: string): boolean {
  return FLAGS[feature] === true;
}

// Usage:
if (isEnabled('threading')) {
  // new threading code path
} else {
  // existing behaviour
}
```

**Workflow:**
1. All new feature work happens on `dev` branch
2. CC pushes to `dev` → Vercel deploys preview
3. Adrian tests on preview URL with his own account
4. When feature is ready → merge `dev` to `main` → production deploys
5. Feature flag can gate rollout even on main (enable for specific users before all users)

**Per-user feature flags (optional, more control):**

```typescript
// Check user profile for feature access
const userFlags = profile?.feature_flags || {};
const globalFlags = JSON.parse(process.env.FEATURE_FLAGS || '{}');

export function isEnabledForUser(feature: string, userId: string): boolean {
  return globalFlags[feature] === true || userFlags[feature] === true;
}
```

This lets you enable threading for Adrian and CTC without enabling it for Lyndsay.

### What this costs

Nothing. Vercel preview deployments are included in the Pro plan. Same API keys, same database. The only overhead is maintaining the dev branch.

---

## Part 2: Threading — Incremental Implementation

Threading touches many systems. Build it in layers so each layer is independently useful and testable before the next one starts.

### Layer 0: Data Model (build now)

Add thread support to the database without changing any UX or conversation flow.

```sql
-- Thread table
CREATE TABLE IF NOT EXISTS threads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  label TEXT NOT NULL,                    -- "embodied cognition", "product architecture"
  status TEXT DEFAULT 'active',           -- active, dormant, candidate
  created_at TIMESTAMPTZ DEFAULT now(),
  last_active_at TIMESTAMPTZ DEFAULT now(),
  
  -- Detection metadata
  detected_from_sessions INT DEFAULT 0,   -- how many sessions contributed to detection
  detection_confidence FLOAT DEFAULT 0,   -- how sure are we this is a real thread
  
  -- Thread context
  summary TEXT,                           -- running summary of this thread's arc
  open_questions JSONB DEFAULT '[]',      -- what's unresolved in this thread
  last_position TEXT,                     -- where we left off, one sentence
  
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES auth.users(id)
);

CREATE INDEX idx_threads_user ON threads(user_id);
CREATE INDEX idx_threads_active ON threads(user_id, status) WHERE status = 'active';

-- Link conversations to threads
ALTER TABLE conversations 
  ADD COLUMN IF NOT EXISTS thread_id UUID REFERENCES threads(id);

-- Link segments to threads (for thread-specific recall)
ALTER TABLE conversation_segments
  ADD COLUMN IF NOT EXISTS thread_id UUID REFERENCES threads(id);
```

This changes nothing about the current experience. Conversations and segments just get an optional `thread_id` that's null until threading is active.

### Layer 1: Thread Detection (build now, runs in background)

At session end, after the structural analysis and summary, run a thread detection step. This identifies candidate threads from accumulated conversation data.

```typescript
async function detectThreadCandidates(
  userId: string,
  currentConversationId: string,
  currentSummary: string,
): Promise<void> {
  if (!isEnabled('threading')) return;

  // Get recent summaries (last 10 sessions)
  const { data: recentSessions } = await supabase
    .from('conversations')
    .select('id, summary, structure, created_at, thread_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10);

  // Get existing threads
  const { data: existingThreads } = await supabase
    .from('threads')
    .select('*')
    .eq('user_id', userId);

  const prompt = `You are analysing conversation patterns to identify coherent threads — topics or lines of thinking that a user keeps returning to across multiple sessions.

EXISTING THREADS:
${existingThreads?.map(t => `- "${t.label}" (${t.status}): ${t.summary}`).join('\n') || 'None yet.'}

RECENT SESSION SUMMARIES (newest first):
${recentSessions?.map(s => `[${s.created_at}] ${s.summary?.substring(0, 500)}`).join('\n\n')}

CURRENT SESSION SUMMARY:
${currentSummary}

Analyse these sessions. Look for:
1. Topics the user has returned to across 3+ sessions (not just mentioned — returned to with developing depth)
2. Lines of thinking that build on each other across sessions
3. Whether any existing threads should be updated or marked dormant

For each candidate thread:
- It must appear across at least 3 separate sessions
- It must show evidence of DEEPENING, not just repetition
- It should have unresolved questions or ongoing momentum

Return JSON:
{
  "new_threads": [
    {
      "label": "short descriptive label",
      "summary": "2-3 sentences describing the arc of this thread",
      "open_questions": ["what's unresolved"],
      "last_position": "where the thread currently sits",
      "confidence": 0.0-1.0,
      "session_ids": ["ids of conversations that belong to this thread"]
    }
  ],
  "updates": [
    {
      "thread_id": "existing thread id",
      "new_summary": "updated summary if the thread developed",
      "new_last_position": "where it sits now",
      "new_open_questions": ["updated"],
      "status": "active or dormant"
    }
  ],
  "assign_current": "thread_id or null — which thread does the current conversation belong to?"
}

Return raw JSON only.`;

  const result = await callModel(
    routing.background.sessionSummary, // Opus
    prompt,
    [{ role: 'user', content: prompt }],
    0.3,
  );

  const parsed = JSON.parse(result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim());

  // Create new threads (only if confidence > 0.7)
  for (const thread of parsed.new_threads || []) {
    if (thread.confidence < 0.7) continue;
    
    const { data: newThread } = await supabase
      .from('threads')
      .insert({
        user_id: userId,
        label: thread.label,
        summary: thread.summary,
        open_questions: thread.open_questions,
        last_position: thread.last_position,
        detection_confidence: thread.confidence,
        detected_from_sessions: thread.session_ids?.length || 3,
        status: 'candidate', // candidate until user interacts with it
      })
      .select()
      .single();

    // Retroactively tag conversations
    if (newThread && thread.session_ids?.length) {
      await supabase
        .from('conversations')
        .update({ thread_id: newThread.id })
        .in('id', thread.session_ids);
    }
  }

  // Update existing threads
  for (const update of parsed.updates || []) {
    await supabase
      .from('threads')
      .update({
        summary: update.new_summary,
        last_position: update.new_last_position,
        open_questions: update.new_open_questions,
        status: update.status,
        last_active_at: update.status === 'active' ? new Date().toISOString() : undefined,
      })
      .eq('id', update.thread_id);
  }

  // Assign current conversation to thread
  if (parsed.assign_current) {
    await supabase
      .from('conversations')
      .update({ thread_id: parsed.assign_current })
      .eq('id', currentConversationId);
  }

  console.log(`[threading] Detected ${parsed.new_threads?.length || 0} new, ${parsed.updates?.length || 0} updates`);
}
```

This runs silently at session end behind the feature flag. It starts building thread data without any UX changes. Adrian can query the threads table to see what the detection is finding.

### Layer 2: Thread-Aware Opener (build next)

When the user starts a new conversation, if they have active threads, the opener incorporates them.

```typescript
async function generateThreadAwareOpener(
  userId: string,
  profile: any,
  conversationCount: number,
): Promise<{ text: string; selectedThreadId?: string }> {
  if (!isEnabled('threading')) {
    return { text: await generateReturningOpener(userId, profile, conversationCount) };
  }

  const { data: activeThreads } = await supabase
    .from('threads')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['active', 'candidate'])
    .order('last_active_at', { ascending: false })
    .limit(5);

  if (!activeThreads?.length) {
    return { text: await generateReturningOpener(userId, profile, conversationCount) };
  }

  // Opener that acknowledges threads without forcing selection
  const threadContext = activeThreads
    .map(t => `- "${t.label}": ${t.last_position}`)
    .join('\n');

  const prompt = `You are Jasper, opening a new conversation with ${profile.identity?.name}.

You have ${activeThreads.length} ongoing threads with them:
${threadContext}

${temporalContext}

Generate a brief, natural opening (1-2 sentences) that:
- Greets them warmly
- Acknowledges you have ongoing threads WITHOUT listing them like a menu
- Leaves space for them to pick up any thread OR start something new
- Does NOT say "which thread would you like to continue?"

A good opener references the most recently active thread lightly but doesn't lock into it.
Example: "Hey Adrian — still thinking about that substrate independence question. But what's on your mind today?"

Bad: "Welcome back! We have threads on embodied cognition, product architecture, and philosophy. Which would you like to continue?"`;

  const text = await callModel(routing.foreground.opener, prompt, [], 0.7);
  return { text, selectedThreadId: activeThreads[0].id };
}
```

### Layer 3: Thread Selection UX (build later)

The web UI shows active threads as soft suggestions — not a mandatory menu, just gentle context.

```
┌─────────────────────────────────────────┐
│  Hey Adrian — still thinking about that │
│  substrate independence question.       │
│  What's on your mind today?             │
│                                         │
│  ┌──────────────┐ ┌──────────────┐     │
│  │ embodied     │ │ product      │     │
│  │ cognition    │ │ architecture │     │
│  └──────────────┘ └──────────────┘     │
│  ┌──────────────┐                       │
│  │ philosophy   │  + something new      │
│  └──────────────┘                       │
│                                         │
│  [text input]                           │
└─────────────────────────────────────────┘
```

Clicking a thread label loads that thread's context — its summary, open questions, and last position — into the system prompt. Typing without selecting a thread starts a general conversation that may get assigned to a thread at session end.

### Layer 4: Thread-Specific Recall (build later)

When a conversation is assigned to a thread (either by user selection or by detection), the recall system prioritises segments from that thread:

```typescript
// In recall, boost segments from the active thread
if (activeThreadId) {
  candidates.forEach(c => {
    if (c.thread_id === activeThreadId) {
      c.score *= 1.5; // boost thread-relevant segments
    }
  });
}
```

The thread's `summary`, `open_questions`, and `last_position` get injected into the system prompt at high priority — giving Jasper explicit awareness of where this line of thinking left off.

---

## Build Order

1. **Now (on dev branch):** Staging environment setup + data model (tables, columns)
2. **This week:** Layer 1 (thread detection at session end, behind feature flag)
3. **Next week:** Layer 2 (thread-aware opener, behind feature flag)
4. **Week after:** Layer 3 (UX thread selection) — only after detection has proven it identifies real threads accurately
5. **Following:** Layer 4 (thread-specific recall)

Each layer is independently testable. Layer 1 just populates a database table — you can query it manually to see if the detection is finding real threads before building any UX around it.

---

## Verification

### Layer 0 (data model)
- Tables exist, no errors on insert
- Existing conversations unaffected (thread_id is null)

### Layer 1 (detection)
After 5+ sessions with Adrian on staging:
```sql
SELECT label, status, detection_confidence, summary, last_position
FROM threads
WHERE user_id = 'ADRIAN_UUID'
ORDER BY last_active_at DESC;
```
Expected: 2-4 threads matching Adrian's actual conversational themes (product architecture, cephalopod philosophy, DBA research, etc.)

### Layer 2 (opener)
Start a new conversation on staging. Opener should reference the most recently active thread without listing all threads. Should feel like "picking up where we left off" not "select from menu."

### Cross-thread awareness
While in a product architecture conversation, mention something about distributed cognition. The relational connection check should find the bridge to the embodied cognition thread. Jasper should reference it naturally.
