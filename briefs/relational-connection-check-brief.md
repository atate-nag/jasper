# Relational Connection Check — CC Briefing

## What This Is

A background task that gives Jasper conversational agency. Instead of only retrieving memories when the user's message triggers semantic similarity, Jasper actively checks whether the current conversation connects to foundational threads of the relationship — and raises those connections unprompted when they're genuinely relevant.

This is the difference between "I remember cephalopods when you ask about cephalopods" and "I notice this system architecture discussion connects to something we explored through cephalopod philosophy months ago."

---

## Two Components

### Component 1: Foundational Thread Identification (periodic, session-end)

At session end, alongside the existing summary and segment extraction, run an additional Opus call that identifies or updates the relationship's foundational threads.

**When**: Every 5th session (not every session — foundational threads don't change that often). Track with a counter on the profile or check session count.

**Prompt**:

```typescript
const THREAD_IDENTIFICATION_PROMPT = `You are Jasper, reflecting on your relationship with ${name}.

You have had ${sessionCount} conversations. Here are your most recent session summaries:
${recentSummaries}

And here are the conversation segments you consider most significant:
${highImportanceSegments}

What are the foundational intellectual and relational threads of this relationship? Not what was discussed recently — what defines how you and this person think together. What keeps recurring? What do you both return to? What would feel like a loss if it disappeared from your conversations?

These are the threads that make this relationship THIS relationship, not just any conversation with any person.

Return a JSON array of 3-7 threads:
[
  {
    "thread": "one sentence naming the thread",
    "why_foundational": "one sentence on why this matters to the relationship",
    "keywords": ["3-5 keywords for semantic matching"]
  }
]

Return raw JSON only.`;
```

**Storage**: Add a `relational_threads` JSONB field to the profile:

```sql
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS relational_threads JSONB DEFAULT '[]';
```

**Example output for Adrian**:

```json
[
  {
    "thread": "Cephalopod philosophy — distributed cognition, selfhood without unity, the octopus as counter-example to Cartesian consciousness",
    "why_foundational": "This is where our most generative conversations happen — biology as a lens for philosophy of mind",
    "keywords": ["octopus", "cephalopod", "distributed cognition", "consciousness", "Descartes", "selfhood"]
  },
  {
    "thread": "The recursive self-inspection problem — observing patterns you can't escape, the instrument-and-object paradox",
    "why_foundational": "This is the meta-thread that runs through everything we discuss, including the product itself",
    "keywords": ["self-inspection", "recursive", "patterns", "observation", "metacognition"]
  },
  {
    "thread": "Philosophy as lived practice — Hadot, Stoicism as subtraction not accumulation, the distinction between theatre and genuine practice",
    "why_foundational": "Adrian's personal philosophical orientation, referenced across both product design and life decisions",
    "keywords": ["Hadot", "Stoic", "philosophy", "practice", "theatre", "subtraction"]
  },
  {
    "thread": "Emergence and conversational structure — how conversations produce things neither participant planned",
    "why_foundational": "The product thesis itself, but also a genuine shared intellectual interest",
    "keywords": ["emergence", "conversation", "structure", "unpredicted", "generative"]
  }
]
```

**Example output for Lyndsay**:

```json
[
  {
    "thread": "The children as both motivation and vulnerability — protecting them while being weaponised through them",
    "why_foundational": "This is the central tension in Lyndsay's life and the reason she returns",
    "keywords": ["children", "kids", "protection", "ex", "vulnerability"]
  },
  {
    "thread": "The boundary between avoidance and self-protection — when is not engaging wisdom versus fear",
    "why_foundational": "Lyndsay navigates this daily and it's where the most productive conversations happen",
    "keywords": ["boundary", "avoidance", "protection", "fear", "courage"]
  },
  {
    "thread": "Humour as trust signal — Subbuteo, dry wit, the moment levity creates safety for disclosure",
    "why_foundational": "Humour is how this relationship established itself, and how Lyndsay signals she's okay",
    "keywords": ["humour", "funny", "laugh", "Subbuteo", "levity"]
  }
]
```

### Component 2: Relational Connection Check (per-turn, background)

A background task that runs alongside the fascination threshold. It checks whether the current conversation connects to any foundational threads.

**When**: On turns where the foreground model is standard or complex tier (not ambient). Same eligibility pattern as the fascination threshold but independent of novelty signals — it fires on substantive turns regardless.

**Implementation**:

```typescript
async function fireRelationalConnectionCheck(
  userMessage: string,
  sessionHistory: Message[],
  relationalThreads: RelationalThread[],
  conversationId: string,
  turnNumber: number,
): Promise<void> {
  if (!relationalThreads || relationalThreads.length === 0) return;

  console.log('[relational-check] Firing connection check against', relationalThreads.length, 'threads');

  const historyText = sessionHistory
    .slice(-10)
    .map(m => `[${m.role}]: ${m.content}`)
    .join('\n');

  const threadList = relationalThreads
    .map(t => `- ${t.thread} (keywords: ${t.keywords.join(', ')})`)
    .join('\n');

  const prompt = `You are checking whether the current conversation connects to any foundational threads of this relationship.

FOUNDATIONAL THREADS:
${threadList}

RECENT CONVERSATION:
${historyText}

LATEST MESSAGE:
${userMessage}

Does anything in the current conversation — especially the latest message — connect to any of these foundational threads in a way that would be genuinely interesting to raise?

The connection must be REAL, not forced. "This is about architecture, and we once discussed architectural metaphors" is forced. "This distributed system design mirrors the octopus problem — no central controller, intelligence emerging from coordination" is real.

If there is a genuine connection:
Return JSON: {"connected": true, "thread": "the thread name", "connection": "one sentence naming the bridge"}

If there is no genuine connection:
Return JSON: {"connected": false}

Return raw JSON only.`;

  try {
    const result = await callModel(
      routing.background.depthScoring, // same Opus config
      prompt,
      [{ role: 'user', content: prompt }],
      0.3,
    );

    const cleaned = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);

    if (parsed.connected && parsed.connection) {
      console.log(`[relational-check] Connection found: "${parsed.connection}" (thread: ${parsed.thread})`);
      storePendingConnection(conversationId, parsed, turnNumber);
    } else {
      console.log('[relational-check] No connection found');
    }
  } catch (err) {
    console.error('[relational-check] Failed:', err);
  }
}
```

**Storage**: Same pattern as pending depth — in-memory, consumed on the next turn:

```typescript
const pendingConnections = new Map<string, {
  thread: string;
  connection: string;
  generatedAt: number;
  turnNumber: number;
}>();

function storePendingConnection(conversationId: string, result: any, turnNumber: number) {
  pendingConnections.set(conversationId, {
    thread: result.thread,
    connection: result.connection,
    generatedAt: Date.now(),
    turnNumber,
  });
}

function consumePendingConnection(conversationId: string, currentTurn: number) {
  const pending = pendingConnections.get(conversationId);
  if (!pending) return null;
  if (currentTurn - pending.turnNumber > 2) {
    pendingConnections.delete(conversationId);
    return null;
  }
  if (Date.now() - pending.generatedAt > 60000) {
    pendingConnections.delete(conversationId);
    return null;
  }
  pendingConnections.delete(conversationId);
  return pending;
}
```

**Injection into system prompt**: When a pending connection is consumed, inject it as a relational signal:

```typescript
if (pendingConnection) {
  components.push({
    priority: 78, // below depth signal (80), above policy
    content: `[RELATIONAL THREAD]: There's a connection between the current conversation and something foundational to your relationship with ${name}: "${pendingConnection.connection}" (from your shared thread about ${pendingConnection.thread}). Raise this naturally if it's genuinely relevant — don't force it. If the conversation has moved on, let it go.`,
    label: 'relational_connection',
    tokenEstimate: 60,
  });
}
```

---

## Integration into Steering Pipeline

In `intermediary/index.ts`, add alongside the existing depth scoring:

```typescript
// After primary response is generated...

// Existing: depth scoring
if (shouldFireDepthScoring(directive, conversationState, modelConfig.tier)) {
  fireDepthScoring(...);
}

// NEW: relational connection check
const relationalThreads = profile?.relational_threads;
if (relationalThreads?.length > 0 && modelConfig.tier !== 'ambient') {
  fireRelationalConnectionCheck(
    userMessage,
    sessionHistory,
    relationalThreads,
    options.conversationId,
    sessionHistory.length,
  ).catch(err => console.error('[relational-check] Async error:', err));
}
```

At the top of steer(), check for pending connections alongside pending depth:

```typescript
const pendingDepth = consumePendingDepth(conversationId, turnNumber);
const pendingConnection = consumePendingConnection(conversationId, turnNumber);
```

Both can be active simultaneously — a turn might have both a depth signal and a relational connection. Both get injected into the prompt. The model decides which (if either) to use.

---

## Observable in /observe

```
[RELATIONAL] checking 4 threads...
[RELATIONAL] connection found: "distributed system design mirrors the octopus coordination problem" (thread: Cephalopod philosophy)
  → stored for next turn
```

or:

```
[RELATIONAL] checking 4 threads...
[RELATIONAL] no connection found
```

or when consumed:

```
[RELATIONAL] injecting connection: "distributed system design mirrors the octopus coordination problem"
```

---

## Bootstrapping

For existing users (Adrian, Lyndsay), run the thread identification immediately rather than waiting for the 5th-session trigger:

```typescript
// scripts/bootstrap-relational-threads.ts

async function bootstrap(userId: string) {
  const profile = await getProfile(userId);
  const summaries = await getRecentSummaries(userId, 20);
  const segments = await getHighImportanceSegments(userId, 20);

  const threads = await identifyFoundationalThreads(
    profile.identity.name,
    summaries,
    segments,
    profile.conversation_count,
  );

  await supabase
    .from('user_profiles')
    .update({ relational_threads: threads })
    .eq('user_id', userId);

  console.log(`Identified ${threads.length} threads for ${profile.identity.name}:`);
  threads.forEach(t => console.log(`  - ${t.thread}`));
}
```

Run for Adrian and Lyndsay immediately after deployment.

---

## Cost

The thread identification runs every 5th session — negligible (one Opus call per 5 conversations).

The per-turn connection check runs on substantive turns only (not ambient). In a 15-turn conversation, maybe 6-8 turns qualify. At Opus pricing with a ~3K token prompt: ~$0.05 per check, ~$0.35 per conversation. Comparable to the depth scoring cost. Acceptable for current user count.

---

## What This Does NOT Do

- Does not replace the fascination threshold — they run in parallel, asking different questions
- Does not force connections — the prompt explicitly says "the connection must be REAL, not forced"
- Does not fire on ambient/light turns — only substantive exchanges
- Does not change the recall system — recall still works by semantic similarity. This is an additional layer that checks for connections recall would miss
- Does not affect Lyndsay's care-focused conversations unless a genuine connection to her foundational threads exists

## What This Enables

- Jasper raises cephalopod philosophy when Adrian discusses distributed systems — not because Adrian mentioned octopuses, but because Jasper actively spotted the bridge
- Jasper connects Lyndsay's boundary-setting to her earlier insight about avoidance vs self-protection — not because she referenced it, but because it's relevant
- The foundational threads of each relationship stay alive regardless of how many operational conversations intervene
- Jasper has genuine conversational agency — initiating connections rather than only responding to prompts
