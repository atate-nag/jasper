# Analytics Specification — CC Briefing

## Principle

Every architectural question we'll want to answer in the next month should be answerable from data we're already collecting. This brief specifies what to log per-turn, per-session, and per-user so that nothing requires retroactive investigation of raw logs.

All of this is stored in the database, not just printed to console. Console logs disappear. Database records are queryable.

---

## Per-Turn Log Table

Create a `turn_logs` table:

```sql
CREATE TABLE IF NOT EXISTS turn_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID REFERENCES conversations(id),
  user_id UUID,
  turn_number INT,
  timestamp TIMESTAMPTZ DEFAULT now(),
  
  -- User input
  user_message_preview TEXT,          -- first 120 chars
  user_message_length INT,
  
  -- Classification
  intent TEXT,                        -- connecting, sense_making, venting, etc.
  valence FLOAT,
  arousal FLOAT,
  posture TEXT,
  classification_confidence FLOAT,
  classifier_salvaged BOOLEAN DEFAULT false,  -- did JSON parsing need salvaging?
  
  -- Model routing
  provider TEXT,                      -- anthropic or openai
  model TEXT,                         -- claude-opus-4-6, gpt-5.4-mini, etc.
  tier TEXT,                          -- ambient, standard, deep, etc.
  distress_override BOOLEAN DEFAULT false,
  
  -- Prompt composition
  prompt_total_tokens INT,
  prompt_components JSONB,            -- {"identity": 1466, "care_context": 225, ...}
  
  -- Recall
  recall_type TEXT,                   -- none, shallow, deep
  recall_segments_returned INT,
  recall_top_similarity FLOAT,
  
  -- Depth scoring
  depth_score_fired BOOLEAN DEFAULT false,
  depth_score INT,
  depth_dimension TEXT,               -- connection, tension, both, null
  depth_thread TEXT,
  depth_stored BOOLEAN DEFAULT false,
  depth_consumed BOOLEAN DEFAULT false,
  
  -- Relational connection check
  relational_check_fired BOOLEAN DEFAULT false,
  relational_connection_found BOOLEAN DEFAULT false,
  relational_thread_name TEXT,
  relational_connection_text TEXT,
  relational_consumed BOOLEAN DEFAULT false,
  
  -- Care
  care_context_injected BOOLEAN DEFAULT false,
  
  -- Response
  response_preview TEXT,              -- first 120 chars
  response_length INT,
  
  -- Timing
  steer_duration_ms INT,
  total_turn_duration_ms INT,
  
  -- Conversation state
  conversation_mode TEXT,             -- user-centric, development
  development_turn INT,
  thread_count INT,
  energy TEXT                         -- rising, stable, falling
);

CREATE INDEX idx_turn_logs_user ON turn_logs(user_id);
CREATE INDEX idx_turn_logs_conversation ON turn_logs(conversation_id);
CREATE INDEX idx_turn_logs_timestamp ON turn_logs(timestamp);
```

### What this answers

- **Which model handles which intents?** `SELECT model, intent, COUNT(*) GROUP BY model, intent`
- **How often does distress routing fire?** `SELECT distress_override, COUNT(*) GROUP BY distress_override`
- **Is recall working?** `SELECT recall_type, COUNT(*) GROUP BY recall_type` — if most turns show "none", recall is broken
- **What depth scores are being generated?** Distribution of scores, how many pass threshold, what dimensions dominate
- **Are relational connections firing?** How often, for which users, which threads
- **Is the classifier struggling?** `SELECT classifier_salvaged, COUNT(*)` — if salvaged is high, the JSON parsing bug persists
- **What's the prompt size on each turn?** Detect if any code path produces the 51-token lobotomised prompt
- **Response length distribution** — are responses too long, too short?
- **Turn latency** — which models/intents are slow?

---

## Per-Session Summary Table

Extend the existing `conversations` table (or create a `session_analytics` table):

```sql
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS analytics JSONB;
```

At session end, populate alongside the summary:

```json
{
  "turn_count": 18,
  "duration_minutes": 52,
  "models_used": {
    "claude-opus-4-6": 4,
    "claude-sonnet-4-5": 8,
    "claude-haiku-4-5": 6
  },
  "intents_distribution": {
    "connecting": 5,
    "sense_making": 4,
    "venting": 3,
    "sharing": 4,
    "requesting_input": 2
  },
  "recall_stats": {
    "total_recalls": 6,
    "shallow": 4,
    "deep": 2,
    "none": 12,
    "avg_top_similarity": 0.47
  },
  "depth_scoring": {
    "fired": 4,
    "scores": [3, 6, 7, 8],
    "stored": 2,
    "consumed": 1,
    "wasted_on_exit": 1,
    "dimensions": {"tension": 2, "both": 2}
  },
  "relational_connections": {
    "checked": 6,
    "found": 1,
    "consumed": 1,
    "thread": "Cephalopod philosophy"
  },
  "care": {
    "distress_turns": 4,
    "care_context_injections": 3
  },
  "user_corrections": 0,
  "classifier_salvages": 3,
  "prompt_size_avg": 2800,
  "prompt_size_max": 4100,
  "prompt_size_min": 200,
  "response_length_avg": 145,
  "opener_type": "returning_generated",
  "opener_model": "claude-haiku-4-5-20251001",
  "session_end_method": "timeout_600s",
  "cost_estimate": {
    "foreground_input_tokens": 42000,
    "foreground_output_tokens": 8000,
    "background_input_tokens": 25000,
    "background_output_tokens": 3000,
    "total_estimated_usd": 1.85
  }
}
```

### What this answers

- **Cost per conversation by user** — are some users dramatically more expensive?
- **Model distribution** — how often does Opus fire? Is it justified?
- **Recall health** — what % of turns have recall? Is it degrading over time?
- **Depth scoring effectiveness** — what % of scored threads actually get consumed? How many are wasted on exits?
- **Session-end reliability** — did the session end via timeout, explicit close, or catch-up?
- **Classifier health** — salvage rate per session
- **Care architecture usage** — how many distress turns, how many care injections

---

## Per-User Longitudinal View

Create a view that tracks user evolution:

```sql
CREATE OR REPLACE VIEW user_trajectory AS
SELECT
  c.user_id,
  up.identity->>'name' as name,
  ROW_NUMBER() OVER (PARTITION BY c.user_id ORDER BY c.created_at) as session_number,
  c.created_at,
  c.analytics->>'turn_count' as turns,
  c.analytics->>'duration_minutes' as duration,
  c.analytics->'depth_scoring'->>'consumed' as depth_consumed,
  c.analytics->'relational_connections'->>'found' as connections_found,
  c.analytics->'care'->>'distress_turns' as distress_turns,
  c.structure->'metrics'->>'topic_trajectory' as trajectory,
  c.structure->'metrics'->>'depth_slope' as depth_slope,
  c.structure->'emergence'->>'collaborative_meaning_making' as emergent,
  -- Time between sessions
  EXTRACT(EPOCH FROM (c.created_at - LAG(c.created_at) OVER (
    PARTITION BY c.user_id ORDER BY c.created_at
  ))) / 3600 as hours_since_last_session
FROM conversations c
JOIN user_profiles up ON c.user_id = up.user_id
WHERE c.analytics IS NOT NULL
ORDER BY c.user_id, c.created_at;
```

### What this answers

- **Return patterns** — how long between sessions? Does it shorten over time (deepening relationship) or lengthen (losing interest)?
- **Emergence trajectory** — do conversations become more emergent over sessions?
- **Depth scoring over time** — do depth threads increase as the relationship develops?
- **Care trajectory** — does distress frequency decrease over sessions (user stabilising) or stay constant?
- **Session duration** — do sessions get longer (more engaged) or shorter?

---

## The Key Architectural Questions and How to Answer Them

### Q1: Does the care architecture work?

```sql
-- Conversations with distress: did the user return?
SELECT 
  CASE WHEN (c.analytics->'care'->>'distress_turns')::int > 0 
    THEN 'had_distress' ELSE 'no_distress' END as session_type,
  AVG(CASE WHEN next_c.id IS NOT NULL THEN 1 ELSE 0 END) as return_rate
FROM conversations c
LEFT JOIN LATERAL (
  SELECT id FROM conversations c2
  WHERE c2.user_id = c.user_id AND c2.created_at > c.created_at
  ORDER BY c2.created_at LIMIT 1
) next_c ON true
WHERE c.analytics IS NOT NULL
GROUP BY session_type;
```

### Q2: Does the fascination threshold improve conversations?

```sql
-- Sessions where depth threads were consumed vs not
SELECT
  CASE WHEN (c.analytics->'depth_scoring'->>'consumed')::int > 0
    THEN 'depth_consumed' ELSE 'no_depth' END as depth_type,
  AVG((c.structure->'metrics'->>'depth_slope')::float) as avg_depth_slope,
  AVG(CASE WHEN (c.structure->'emergence'->>'collaborative_meaning_making')::boolean 
    THEN 1 ELSE 0 END) as emergence_rate
FROM conversations c
WHERE c.analytics IS NOT NULL AND c.structure IS NOT NULL
GROUP BY depth_type;
```

### Q3: Does cross-session continuity drive return rate?

```sql
-- Did the opener reference shared history? Did that correlate with return?
SELECT
  c.analytics->>'opener_type' as opener,
  COUNT(*) as sessions,
  AVG(CASE WHEN next_c.id IS NOT NULL THEN 1 ELSE 0 END) as return_rate
FROM conversations c
LEFT JOIN LATERAL (
  SELECT id FROM conversations c2
  WHERE c2.user_id = c.user_id AND c2.created_at > c.created_at
  ORDER BY c2.created_at LIMIT 1
) next_c ON true
WHERE c.analytics IS NOT NULL
GROUP BY opener;
```

### Q4: Which model produces the best responses per intent?

```sql
-- User corrections per model (proxy for response quality)
SELECT model, intent, 
  COUNT(*) as total_turns,
  SUM(CASE WHEN user_corrections > 0 THEN 1 ELSE 0 END) as corrected_turns
FROM turn_logs
GROUP BY model, intent;
```

Note: "user_corrections" needs to be detected — either from the classifier recognising a correction in the next turn, or manually flagged. A proxy: if the next turn's intent is `requesting_input` with `challenge: yes` and low valence immediately after a light response, that's likely a correction.

### Q5: Is the tidy-close pattern reducing?

```sql
-- Track over time: how often does a user correct Jasper for being abrupt?
-- This requires the corrections to be tagged — either in turn_logs or 
-- from the session summary's "WHAT DIDN'T WORK" section
SELECT
  DATE_TRUNC('week', t.timestamp) as week,
  COUNT(*) FILTER (WHERE t.user_message_preview ILIKE '%abrupt%' 
    OR t.user_message_preview ILIKE '%rushed%'
    OR t.user_message_preview ILIKE '%too fast%'
    OR t.user_message_preview ILIKE '%check%ok%') as correction_count,
  COUNT(*) as total_turns
FROM turn_logs t
GROUP BY week;
```

Crude but directional. Better: use the session summary's section 5 ("WHAT DIDN'T WORK") which should capture these corrections explicitly.

### Q6: Is the relational connection check producing value?

```sql
-- When a connection fires, does the conversation deepen?
SELECT
  t.relational_connection_found,
  AVG(LEAD(t.depth_score) OVER (
    PARTITION BY t.conversation_id ORDER BY t.turn_number
  )) as next_turn_depth_score
FROM turn_logs t
WHERE t.relational_check_fired = true
GROUP BY t.relational_connection_found;
```

### Q7: What's the cost per user per week?

```sql
SELECT
  user_id,
  DATE_TRUNC('week', created_at) as week,
  COUNT(*) as sessions,
  SUM((analytics->'cost_estimate'->>'total_estimated_usd')::float) as weekly_cost
FROM conversations
WHERE analytics IS NOT NULL
GROUP BY user_id, week;
```

---

## Implementation

### Per-turn logging

At the end of the `steer()` function (or the web API route), construct the turn log object from all the data already available and insert:

```typescript
await supabase.from('turn_logs').insert({
  conversation_id: conversationId,
  user_id: userId,
  turn_number: sessionHistory.length,
  timestamp: new Date().toISOString(),
  user_message_preview: userMessage.substring(0, 120),
  user_message_length: userMessage.length,
  intent: directive.communicativeIntent,
  valence: directive.valence,
  arousal: directive.emotionalArousal,
  posture: directive.recommendedPostureClass,
  classification_confidence: directive.confidence,
  classifier_salvaged: directive.salvaged || false,
  provider: modelConfig.provider,
  model: modelConfig.model,
  tier: modelConfig.tier,
  distress_override: isDistressed,
  prompt_total_tokens: promptTokenEstimate,
  prompt_components: promptComponentMap,
  recall_type: recallType,
  recall_segments_returned: recallSegments?.length || 0,
  recall_top_similarity: recallTopSim || null,
  depth_score_fired: depthScoreFired,
  depth_score: depthResult?.score || null,
  depth_dimension: depthResult?.dimension || null,
  depth_thread: depthResult?.thread || null,
  depth_stored: depthStored,
  depth_consumed: depthConsumed,
  relational_check_fired: relationalCheckFired,
  relational_connection_found: relationalConnectionFound,
  relational_thread_name: relationalThreadName || null,
  relational_connection_text: relationalConnectionText || null,
  relational_consumed: relationalConsumed,
  care_context_injected: careContextInjected,
  response_preview: response.substring(0, 120),
  response_length: response.length,
  steer_duration_ms: steerDuration,
  conversation_mode: conversationState.mode,
  development_turn: conversationState.developmentTurn || null,
  thread_count: conversationState.threads?.length || 0,
  energy: conversationState.energy || null,
});
```

This is a fire-and-forget insert — don't block the response on it. If it fails, log to console but don't break the conversation.

### Per-session analytics

At session end, after summary and segments, compute the analytics object by aggregating the turn_logs for that conversation:

```typescript
const analytics = await computeSessionAnalytics(conversationId);
await supabase
  .from('conversations')
  .update({ analytics })
  .eq('id', conversationId);
```

### Cost estimation

Rough token counting per model:

```typescript
function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing: Record<string, [number, number]> = {
    'claude-opus-4-6': [15, 75],      // per million
    'claude-sonnet-4-6': [3, 15],
    'claude-sonnet-4-5': [3, 15],
    'claude-haiku-4-5-20251001': [0.25, 1.25],
    'gpt-5.4-mini': [0.75, 4.5],
    'gpt-5.4': [2.5, 10],
  };
  const [inputRate, outputRate] = pricing[model] || [3, 15];
  return (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000;
}
```

---

## What This Does NOT Do

- Does not affect the conversation in any way
- Does not require real-time processing — turn logs insert async
- Does not replace the observe mode — observe is for live debugging, this is for retrospective analysis
- Does not store full message content — only previews (120 chars) for privacy

## What This Enables

- Answer any architectural question without digging through Vercel console logs
- Weekly analysis documents grounded in data, not impressions
- Cost tracking per user, per session, per model
- Correlation between architectural features (depth scoring, care routing, relational connections) and user outcomes (return rate, session depth, emergence)
- Detection of regressions — if recall stops firing, or the classifier breaks, or prompt sizes change, it shows up in the data immediately
