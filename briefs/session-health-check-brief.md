# Session Health Check — CC Briefing

## Problem

Session summaries weren't deploying on Vercel and nobody noticed until manually checking. Every component of the session-end pipeline could silently fail without detection: summary, segment extraction, structural analysis, calibration update, metacognition, profile classification. We need a health check that flags missing steps immediately, not days later.

## Two Components

### Component 1: Session-End Completion Log

At the end of the session-end pipeline, write a single health record that confirms what ran and what didn't.

```sql
CREATE TABLE IF NOT EXISTS session_health (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID REFERENCES conversations(id),
  user_id UUID,
  completed_at TIMESTAMPTZ DEFAULT now(),
  
  -- What fired
  summary_generated BOOLEAN DEFAULT false,
  summary_model TEXT,                    -- which model ran it
  segments_extracted BOOLEAN DEFAULT false,
  segments_count INT DEFAULT 0,
  segments_inserted BOOLEAN DEFAULT false, -- did they actually store (no RLS error)
  structural_analysis BOOLEAN DEFAULT false,
  calibration_updated BOOLEAN DEFAULT false,
  metacognition_ran BOOLEAN DEFAULT false,
  metacognition_patterns INT DEFAULT 0,
  profile_updated BOOLEAN DEFAULT false,
  relational_threads_updated BOOLEAN DEFAULT false,
  
  -- Session context
  turn_count INT,
  session_duration_seconds INT,
  end_trigger TEXT,                      -- timeout, explicit_close, catchup, cron
  
  -- Errors
  errors JSONB DEFAULT '[]'             -- array of error messages
);

CREATE INDEX idx_session_health_user ON session_health(user_id);
CREATE INDEX idx_session_health_time ON session_health(completed_at);
```

At the end of the session-end pipeline:

```typescript
const health: SessionHealth = {
  conversation_id: conversationId,
  user_id: userId,
  turn_count: messages.length,
  session_duration_seconds: sessionDuration,
  end_trigger: endTrigger, // 'timeout' | 'explicit_close' | 'catchup' | 'cron'
  errors: [],
  
  summary_generated: false,
  segments_extracted: false,
  segments_inserted: false,
  structural_analysis: false,
  calibration_updated: false,
  metacognition_ran: false,
  profile_updated: false,
};

// After each step, update the health record
try {
  const summary = await generateSummary(...);
  health.summary_generated = true;
  health.summary_model = 'claude-opus-4-6';
} catch (err) {
  health.errors.push({ step: 'summary', error: err.message });
}

try {
  const segments = await extractSegments(...);
  health.segments_extracted = true;
  health.segments_count = segments.length;
  
  const insertResults = await insertSegments(segments);
  health.segments_inserted = insertResults.every(r => r.success);
  if (!health.segments_inserted) {
    health.errors.push({ step: 'segment_insert', error: 'RLS or insert failure' });
  }
} catch (err) {
  health.errors.push({ step: 'segments', error: err.message });
}

// ... same pattern for structural_analysis, calibration, metacognition, profile

// Write health record at the end regardless of what failed
await supabase.from('session_health').insert(health);
console.log(`[session-health] ${Object.entries(health)
  .filter(([k, v]) => typeof v === 'boolean')
  .map(([k, v]) => `${k}:${v ? '✓' : '✗'}`)
  .join(' | ')}`);
```

Console output:

```
[session-health] summary:✓ | segments:✓ | inserted:✓ | structure:✓ | calibration:✓ | metacognition:✓ | profile:✓
```

or when something fails:

```
[session-health] summary:✓ | segments:✓ | inserted:✗ | structure:✗ | calibration:✓ | metacognition:✓ | profile:✓
  errors: [{"step":"segment_insert","error":"RLS policy"},{"step":"structure","error":"timeout"}]
```

### Component 2: Per-Conversation Completeness Check

A simple query that shows whether each conversation got its full post-processing:

```sql
CREATE OR REPLACE VIEW conversation_completeness AS
SELECT
  c.id as conversation_id,
  c.user_id,
  up.identity->>'name' as user_name,
  c.created_at,
  jsonb_array_length(c.messages) as turn_count,
  
  -- What should exist
  c.summary IS NOT NULL as has_summary,
  c.structure IS NOT NULL as has_structure,
  c.analytics IS NOT NULL as has_analytics,
  
  -- Session health (if available)
  sh.summary_generated,
  sh.segments_extracted,
  sh.segments_inserted,
  sh.structural_analysis,
  sh.calibration_updated,
  sh.metacognition_ran,
  sh.profile_updated,
  sh.end_trigger,
  sh.errors,
  
  -- Segments actually in the database for this conversation
  (SELECT COUNT(*) FROM conversation_segments cs 
   WHERE cs.conversation_id = c.id) as segment_count,
   
  -- Red flags
  CASE
    WHEN c.summary IS NULL AND jsonb_array_length(c.messages) >= 4 
      THEN 'MISSING_SUMMARY'
    WHEN sh.id IS NULL AND jsonb_array_length(c.messages) >= 4 
      THEN 'SESSION_END_NEVER_FIRED'
    WHEN sh.segments_inserted = false 
      THEN 'SEGMENTS_FAILED'
    WHEN sh.errors != '[]'::jsonb 
      THEN 'HAS_ERRORS'
    ELSE 'OK'
  END as status

FROM conversations c
LEFT JOIN user_profiles up ON c.user_id = up.user_id
LEFT JOIN session_health sh ON sh.conversation_id = c.id
ORDER BY c.created_at DESC;
```

### Component 3: Daily Health Dashboard Query

Run this every morning before checking transcripts:

```sql
-- Quick health check: any conversations missing post-processing?
SELECT 
  status,
  COUNT(*) as count,
  array_agg(conversation_id) as conversation_ids
FROM conversation_completeness
WHERE created_at > now() - interval '24 hours'
GROUP BY status;
```

Expected output when everything works:

```
 status | count | conversation_ids
--------+-------+------------------
 OK     |     7 | {uuid1, uuid2, ...}
```

When something broke:

```
 status                  | count | conversation_ids
-------------------------+-------+------------------
 OK                      |     5 | {uuid1, uuid2, ...}
 MISSING_SUMMARY         |     1 | {uuid6}
 SESSION_END_NEVER_FIRED |     1 | {uuid7}
```

### Component 4: Per-Turn Health (lightweight)

The turn_logs table from the analytics brief already captures most per-turn data. Add one field:

```sql
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS
  identity_tokens INT;
```

Populate from the prompt components. If this ever shows a value below 1000, the lobotomised-prompt bug has returned. Alert condition:

```sql
-- Check for identity stripping
SELECT conversation_id, turn_number, identity_tokens
FROM turn_logs
WHERE identity_tokens < 1000
  AND timestamp > now() - interval '24 hours';
```

Should return zero rows. If it returns anything, the `isLightIntent` bug or something similar has resurfaced.

---

## What To Check Before Real Users Start

Run these three queries:

**1. Are all recent conversations fully processed?**

```sql
SELECT status, COUNT(*) 
FROM conversation_completeness 
WHERE created_at > now() - interval '7 days'
GROUP BY status;
```

Everything should be OK. Any MISSING_SUMMARY or SESSION_END_NEVER_FIRED rows need investigating.

**2. Are segments actually storing?**

```sql
SELECT 
  c.user_id,
  up.identity->>'name' as name,
  COUNT(DISTINCT c.id) as conversations,
  COUNT(cs.id) as total_segments
FROM conversations c
JOIN user_profiles up ON c.user_id = up.user_id
LEFT JOIN conversation_segments cs ON cs.conversation_id = c.id
WHERE c.created_at > now() - interval '7 days'
GROUP BY c.user_id, up.identity->>'name';
```

Every user with 4+ turn conversations should have segments. Zero segments = the RLS bug is back.

**3. Is the identity prompt full on every turn?**

```sql
SELECT COUNT(*) as total_turns,
  COUNT(*) FILTER (WHERE identity_tokens < 1000) as lobotomised_turns
FROM turn_logs
WHERE timestamp > now() - interval '24 hours';
```

Lobotomised turns should be zero.

---

## Observable in /observe (CLI)

At session end, print the health summary:

```
[SESSION-END] Health check:
  ✓ summary (opus, 847 tokens)
  ✓ segments (5 extracted, 5 inserted)
  ✓ structure (branching, depth_slope: 0.4)
  ✓ calibration (challenge: 0.82, humour: 0.71)
  ✓ metacognition (2 patterns)
  ✓ profile updated
```

or:

```
[SESSION-END] Health check:
  ✓ summary (opus, 847 tokens)
  ✗ segments (5 extracted, 0 inserted — RLS ERROR)
  ✗ structure (timeout)
  ✓ calibration (challenge: 0.82, humour: 0.71)
  ✓ metacognition (2 patterns)
  ✓ profile updated
  ERRORS: 2 — investigate before next session
```

---

## Cost

Zero. This is logging, not model calls. The session_health table adds one row per session. The identity_tokens field is already computed during prompt assembly — just store it.

## What This Prevents

- Silent failures like the summary deployment bug going unnoticed for days
- RLS segment insertion failures accumulating without detection
- Identity prompt stripping returning without anyone noticing
- Session-end pipeline not firing on web (timeout, cron, or catch-up failures)
- Users having conversations that produce no lasting memory
