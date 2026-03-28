# Two-Dimension Model Routing — CC Briefing

## The Problem with Current Routing

Model selection is currently one-dimensional: how important is this turn? That produces a single tier (ambient/standard/complex) mapped to a single model. But there are actually two categories of work happening:

**Foreground**: The user sees the response. Latency matters. Character consistency matters. Cost per turn matters.

**Background**: Async processing the user never sees. Quality matters. Frame width matters. Latency is irrelevant. Cost per call is acceptable because these fire selectively, not every turn.

Currently, background tasks (depth scoring, session-end processing) use the same routing as foreground. This means the fascination threshold runs on Sonnet with a 10-message window and a compressed prompt. Session-end summaries run on whatever model last handled the conversation. Background tasks are being starved of context and capability because they're sharing a routing system designed for latency-sensitive foreground work.

---

## New Routing Structure

```typescript
export interface ModelRouting {
  foreground: {
    ambient: ModelConfig;    // greetings, small talk, phatic
    standard: ModelConfig;   // substance, analysis
    complex: ModelConfig;    // deep engagement, distress
    opener: ModelConfig;     // returning user greeting
  };
  background: {
    depthScoring: ModelConfig;      // fascination threshold evaluation
    careEvaluation: ModelConfig;    // distress/relational context evaluation
    sessionSummary: ModelConfig;    // end-of-session summary generation
    segmentExtraction: ModelConfig; // memory segment extraction + embedding
  };
}
```

### Default Configuration

```typescript
export const DEFAULT_ROUTING: ModelRouting = {
  foreground: {
    ambient: {
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 200,
      defaultTemperature: 0.7,
    },
    standard: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      maxTokens: 2000,
      defaultTemperature: 0.7,
    },
    complex: {
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      maxTokens: 2000,
      defaultTemperature: 0.7,
    },
    opener: {
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      maxTokens: 100,
      defaultTemperature: 0.7,
    },
  },
  background: {
    depthScoring: {
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      maxTokens: 500,
      defaultTemperature: 0.3,
    },
    careEvaluation: {
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      maxTokens: 500,
      defaultTemperature: 0.3,
    },
    sessionSummary: {
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      maxTokens: 1000,
      defaultTemperature: 0.5,
    },
    segmentExtraction: {
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      maxTokens: 1000,
      defaultTemperature: 0.5,
    },
  },
};

// Mixed routing — OpenAI for warm foreground, Anthropic for depth
export const MIXED_ROUTING: ModelRouting = {
  foreground: {
    ambient: {
      provider: 'openai',
      model: 'gpt-5.4-mini',
      maxTokens: 200,
      defaultTemperature: 0.7,
    },
    standard: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      maxTokens: 2000,
      defaultTemperature: 0.7,
    },
    complex: {
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      maxTokens: 2000,
      defaultTemperature: 0.7,
    },
    opener: {
      provider: 'openai',
      model: 'gpt-5.4-mini',
      maxTokens: 100,
      defaultTemperature: 0.7,
    },
  },
  background: {
    // All background tasks on Opus regardless of foreground mix
    depthScoring: {
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      maxTokens: 500,
      defaultTemperature: 0.3,
    },
    careEvaluation: {
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      maxTokens: 500,
      defaultTemperature: 0.3,
    },
    sessionSummary: {
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      maxTokens: 1000,
      defaultTemperature: 0.5,
    },
    segmentExtraction: {
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      maxTokens: 1000,
      defaultTemperature: 0.5,
    },
  },
};
```

---

## Using the Context Window Effectively

Opus 4.6 has a 1 million token context window. Our current system prompts are 3,000-5,000 tokens. The foreground conversation history might be 2,000-10,000 tokens. We are using less than 2% of what's available.

Background tasks should use this capacity. They are not latency-sensitive. They can receive everything we have and reason about it deeply.

### What each background task should receive

**Depth Scoring** (currently: 10-message window + short rubric prompt)

Should receive:
- Full conversation history (all turns, not last 10)
- Complete user profile (not compressed)
- Person-context block
- All recalled segments that were surfaced during this session
- The full scoring rubric

This gives Opus the ability to score not just "is this message interesting" but "is this message interesting in the context of everything I know about this person and this conversation's trajectory."

**Care Evaluation** (new — fires when distress signals present)

Should receive:
- Full conversation history
- Complete user profile including relationships, stress_responses, active_concerns
- All recalled segments
- Previous session summaries (last 3-5)
- Prompt asking: "Given everything you know about this person, what do they actually need right now? Not what their words are asking for. What they need."

Returns: a care context object that gets injected into the foreground prompt for the next response.

**Session Summary** (currently: conversation + short summarisation prompt)

Should receive:
- Full conversation transcript
- Complete user profile
- Previous session summaries (for continuity)
- Prompt asking for affective structure, turning points, what shifted, what was left unresolved, what mattered to the person (not just what was discussed)

**Segment Extraction** (currently: conversation + extraction prompt)

Should receive:
- Full conversation transcript
- Complete user profile
- Previous segments (to avoid duplication)
- Prompt asking to extract moments that were significant to the person, not just to the conversation — including care moments, not just intellectual ones

### Implementation Pattern

Each background task builds its own context payload without the token budgeting that foreground tasks require:

```typescript
async function buildBackgroundContext(
  userId: string,
  conversationHistory: Message[],
  profile: any,
  options?: {
    includeRecalledSegments?: boolean;
    includePreviousSummaries?: boolean;
    maxPreviousSummaries?: number;
  }
): Promise<string> {
  const parts: string[] = [];

  // Full profile — no compression
  parts.push('=== USER PROFILE ===');
  parts.push(JSON.stringify(profile, null, 2));

  // Full conversation — no truncation
  parts.push('\n=== CONVERSATION ===');
  for (const msg of conversationHistory) {
    parts.push(`[${msg.role}]: ${msg.content}`);
  }

  // Recalled segments from this session
  if (options?.includeRecalledSegments) {
    const segments = await getAllRecalledSegments(userId);
    if (segments.length > 0) {
      parts.push('\n=== RECALLED SEGMENTS FROM PAST CONVERSATIONS ===');
      for (const seg of segments) {
        parts.push(`- ${seg.content}`);
      }
    }
  }

  // Previous session summaries
  if (options?.includePreviousSummaries) {
    const max = options.maxPreviousSummaries || 5;
    const summaries = await getRecentSummaries(userId, max);
    if (summaries.length > 0) {
      parts.push('\n=== PREVIOUS SESSION SUMMARIES ===');
      for (const sum of summaries) {
        parts.push(`[${sum.created_at}]: ${sum.summary}`);
      }
    }
  }

  return parts.join('\n');
}
```

This is fed to `callModel` with the background routing config. No compression, no priority ordering, no token budget. Just everything we have.

At current conversation lengths (10-30 turns, 500-2000 words of profile), we're still well under 50K tokens even with full context. The 1M window means we could include entire past conversations verbatim if needed. For now, summaries + segments are sufficient — but the option to expand is there.

---

## Integration: Where Background Tasks Fire

### Depth Scoring
- **When**: foreground model is ambient tier AND 2+ novelty signals (unchanged)
- **How**: async, non-blocking, fire-and-forget with timeout
- **Change**: use `routing.background.depthScoring` instead of hardcoded Sonnet
- **Change**: pass full context via `buildBackgroundContext` instead of 10-message window

### Care Evaluation
- **When**: classifier detects distress (valence < -0.2, arousal > 0.5) OR user profile has active_concerns flagged as emotional
- **How**: async, non-blocking, same pattern as depth scoring
- **Fires**: `callModel(routing.background.careEvaluation, carePrompt, ...)`
- **Returns**: care context object stored for injection into next foreground turn
- **Note**: this runs ALONGSIDE the foreground response, not instead of it. The foreground response still goes out (possibly on Opus via the distress routing). The care evaluation enriches the NEXT turn.

### Session Summary
- **When**: session end (timeout, explicit close, or catch-up on next session start)
- **How**: synchronous (session is ending, no latency concern)
- **Change**: use `routing.background.sessionSummary` instead of whatever model happened to be active
- **Change**: pass full conversation + profile + previous summaries

### Segment Extraction
- **When**: immediately after session summary
- **How**: synchronous
- **Change**: use `routing.background.segmentExtraction`
- **Change**: pass full conversation + profile + existing segments (for deduplication)

---

## Updating Existing Code

### model-client.ts

The `callModel` function already handles both providers. No change needed — background tasks just pass a different config from the routing object.

### intermediary/index.ts (or equivalent steering module)

Change how the model config is resolved:

```typescript
// OLD: single dimension
const modelConfig = selectForegroundModel(directive, policy, conversationState);

// NEW: foreground gets its config, background tasks get theirs
const foregroundConfig = selectForegroundModel(directive, policy, conversationState);

// Depth scoring uses background routing
if (shouldFireDepthScoring(directive, conversationState, foregroundConfig.tier)) {
  fireDepthScoring(
    userMessage,
    sessionHistory,
    conversationId,
    sessionHistory.length,
    routing.background.depthScoring,  // explicit background config
    fullContext,                       // rich context, not truncated
  );
}

// Care evaluation uses background routing
if (isDistressed(directive)) {
  fireCareEvaluation(
    userMessage,
    sessionHistory,
    profile,
    routing.background.careEvaluation,
    fullContext,
  );
}
```

### Session-end processing

```typescript
// OLD: uses whatever model was last active
const summary = await generateSummary(conversation, profile);

// NEW: explicitly uses background routing with full context
const bgContext = await buildBackgroundContext(userId, conversation, profile, {
  includePreviousSummaries: true,
  maxPreviousSummaries: 5,
});

const summary = await callModel(
  routing.background.sessionSummary,
  SESSION_SUMMARY_PROMPT,
  [{ role: 'user', content: bgContext }],
);

const segments = await callModel(
  routing.background.segmentExtraction,
  SEGMENT_EXTRACTION_PROMPT,
  [{ role: 'user', content: bgContext }],
);
```

---

## Logging

Background tasks should log which model and context size they used:

```
[depth-scoring] Opus | context: 12,450 tokens | scoring...
[care-eval] Opus | context: 15,200 tokens | evaluating...
[session-end] Opus | context: 28,100 tokens | summarising...
[segments] Opus | context: 28,100 tokens | extracting...
```

This lets you monitor whether the expanded context is actually being used and correlate context size with output quality.

---

## Cost Estimate

Opus pricing is approximately $15/M input, $75/M output.

Per conversation (assuming 15 turns):
- Depth scoring: 3-4 fires × ~15K input tokens × $15/M = ~$0.70
- Care evaluation: 0-3 fires × ~20K input tokens × $15/M = ~$0.90 (only when distress detected)
- Session summary: 1 fire × ~30K input = ~$0.45
- Segment extraction: 1 fire × ~30K input = ~$0.45

Worst case per conversation (distress throughout): ~$2.50
Typical conversation (some depth, no distress): ~$1.50
Per day (3 users, 2 conversations each): ~$9-15/day

Manageable for 3 users. Re-evaluate if scaling beyond 10.

---

## Verification

1. Start a conversation. Check logs — foreground turns should show the expected model (Haiku/Sonnet/Opus per normal routing)
2. Say something that triggers depth scoring. Check logs — depth scoring should show `claude-opus-4-6` and a context size larger than before
3. Say something distressed. Check logs — foreground routes to Opus, AND a care evaluation fires in background on Opus
4. End the session. Check logs — session summary and segment extraction both run on Opus with full context
5. Compare a session summary generated with full Opus context against a previous summary. The new one should capture affective structure and turning points, not just topics.
