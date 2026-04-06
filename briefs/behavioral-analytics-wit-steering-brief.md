# Behavioural Analytics + Wit Steering — CC Briefing

Two additions. The first extends the analytics to track relationship development, not just architectural performance. The second steers toward conditions that produce Jasper's most effective cold-start behaviour: dry wit.

---

## Part 1: Behavioural Analytics

### Problem

The current analytics track whether the architecture worked (recall fired, distress routed, depth scored). They don't track whether the *relationship* is developing. We need leading indicators that show emergence warming up, trailing indicators that show it happened, and meta indicators that correlate emergence with retention.

### Schema Additions to turn_logs

```sql
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS
  correction_detected BOOLEAN DEFAULT false;

ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS
  disclosure_depth FLOAT;

ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS
  user_initiated_topic BOOLEAN DEFAULT false;

ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS
  wit_detected BOOLEAN DEFAULT false;
```

### How to populate them

**correction_detected**: Reuse the relational feedback detection logic. If `isRelationalFeedback()` returns true for this turn, set `correction_detected = true`. This is already computed for the routing override — just store the result.

```typescript
const isCorrection = isRelationalFeedback(directive, userMessage);
// ... in turn_log insert:
correction_detected: isCorrection,
```

**disclosure_depth**: Use the classifier's arousal value on sharing, venting, and distress intents as a proxy. Higher arousal on these intents means the user is sharing something more vulnerable. On other intents (connecting, requesting_input, sense_making), set to 0.

```typescript
const disclosureIntents = ['sharing', 'venting', 'distress'];
const disclosureDepth = disclosureIntents.includes(directive.communicativeIntent)
  ? directive.emotionalArousal
  : 0;
```

**user_initiated_topic**: Check the classifier's topic_continuity signal. If the user introduced a new topic or shifted topic (rather than responding to Jasper's question or continuing the same thread), set to true.

```typescript
// Simplest proxy: did the user's message introduce something new?
// If the classifier detected 'new' or 'shift' in topic continuity, 
// or if the turn is the user's first substantive message after a greeting
const userInitiated = directive.topicContinuity === 'new' 
  || directive.topicContinuity === 'shift';
```

If the classifier doesn't currently output topic_continuity, use a simpler proxy: if the user's message is longer than 50 characters and the previous Jasper message ended without a question, the user initiated.

**wit_detected**: This is harder to detect automatically. Two approaches:

Option A (simple): Check if the user's *next* message contains laughter signals — "ha", "lol", "haha", "that's funny", "made me laugh", emoji. If so, mark the *preceding* Jasper turn as `wit_detected = true`. This is a trailing indicator — it detects wit that landed, not wit that was attempted.

```typescript
// On each user turn, check if it signals laughter
const laughterPatterns = /\b(ha|haha|lol|lmao|rofl|funny|laugh|😂|🤣)\b/i;
if (laughterPatterns.test(userMessage)) {
  // Mark the PREVIOUS Jasper turn as wit_detected
  await supabase
    .from('turn_logs')
    .update({ wit_detected: true })
    .eq('conversation_id', conversationId)
    .eq('turn_number', currentTurnNumber - 1);
}
```

Option B (better but more expensive): At session end, ask Haiku to identify which Jasper turns contained dry wit. One call, low cost. But this can wait — Option A is good enough to start.

### Session Analytics Additions

Add to the per-session analytics JSON:

```typescript
const behavioralMetrics = {
  // Leading indicators
  correction_count: turnLogs.filter(t => t.correction_detected).length,
  max_disclosure_depth: Math.max(...turnLogs.map(t => t.disclosure_depth || 0)),
  avg_disclosure_depth: average(turnLogs.filter(t => t.disclosure_depth > 0).map(t => t.disclosure_depth)),
  user_initiation_ratio: turnLogs.filter(t => t.user_initiated_topic).length / turnLogs.length,
  
  // Wit metrics
  wit_landed_count: turnLogs.filter(t => t.wit_detected).length,
  wit_in_first_10_turns: turnLogs.filter(t => t.wit_detected && t.turn_number <= 10).length,
  
  // Trailing indicators (computed at session level)
  session_gap_hours: hourssSinceLastSession,
  user_referenced_previous: userReferencedPrevious, // boolean — did user mention something from a prior session unprompted?
  
  // Conversation shape
  turns_before_first_disclosure: firstDisclosureTurn,
  turns_before_first_wit: firstWitTurn,
};
```

### Key Queries

**Leading indicator trajectory per user:**

```sql
SELECT
  user_id,
  ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at) as session_number,
  (analytics->'behavioral'->>'correction_count')::int as corrections,
  (analytics->'behavioral'->>'max_disclosure_depth')::float as disclosure_depth,
  (analytics->'behavioral'->>'user_initiation_ratio')::float as initiation_ratio,
  (analytics->'behavioral'->>'wit_landed_count')::int as wit_count
FROM conversations
WHERE analytics->'behavioral' IS NOT NULL
ORDER BY user_id, created_at;
```

If corrections decrease and disclosure depth increases over sessions, the relationship is developing.

**Meta indicator — does emergence predict retention?**

```sql
SELECT
  CASE 
    WHEN (analytics->'behavioral'->>'wit_landed_count')::int > 0 
      AND (analytics->'behavioral'->>'max_disclosure_depth')::float > 0.5
    THEN 'emergent'
    ELSE 'non_emergent'
  END as session_type,
  AVG(CASE WHEN next_c.id IS NOT NULL THEN 1 ELSE 0 END) as return_rate,
  AVG((analytics->'behavioral'->>'session_gap_hours')::float) as avg_gap_hours
FROM conversations c
LEFT JOIN LATERAL (
  SELECT id FROM conversations c2
  WHERE c2.user_id = c.user_id AND c2.created_at > c.created_at
  ORDER BY c2.created_at LIMIT 1
) next_c ON true
WHERE analytics->'behavioral' IS NOT NULL
GROUP BY session_type;
```

**Wit as cold-start predictor:**

```sql
-- Do users who experience wit in session 1 return for session 2?
WITH first_sessions AS (
  SELECT DISTINCT ON (user_id) 
    user_id, id, analytics
  FROM conversations
  ORDER BY user_id, created_at
)
SELECT
  CASE WHEN (fs.analytics->'behavioral'->>'wit_landed_count')::int > 0
    THEN 'wit_in_session_1' ELSE 'no_wit' END as first_session_type,
  AVG(CASE WHEN next_c.id IS NOT NULL THEN 1 ELSE 0 END) as return_rate
FROM first_sessions fs
LEFT JOIN LATERAL (
  SELECT id FROM conversations c2
  WHERE c2.user_id = fs.user_id AND c2.created_at > (
    SELECT created_at FROM conversations WHERE id = fs.id
  )
  ORDER BY c2.created_at LIMIT 1
) next_c ON true
GROUP BY first_session_type;
```

---

## Part 2: Wit Steering

### Problem

Dry wit is Jasper's most effective cold-start tool. 67 instances analysed: 51% landed in the first 10 turns, wit creates warmth rather than requiring it, and successful wit clusters temporally (one landing creates permission for more). But care routing, distress detection, and therapeutic framing all suppress the conditions that produce wit. The architecture needs to protect space for wit without forcing it.

### What We're NOT Doing

- Not adding a "be witty" instruction — forced wit falls flat
- Not increasing temperature for wit — that produces random humor, not dry observation
- Not adding wit examples to the prompt — that creates template-matching
- Not programming when wit should fire — it's emergent and can't be scheduled

### What We ARE Doing

Protecting the conditions that allow wit to emerge, and removing things that suppress it.

### Change 1: Don't suppress analytical/playful register on light turns

This was already fixed by removing `isLightIntent`. Verify it's gone. On light turns, Jasper should have his full identity including the "slightly dry — your humour comes from noticing absurdity and naming it simply" character description. Without this, Haiku produces bland safe responses instead of sharp ones.

**Status: Should already be active. Verify.**

### Change 2: Tighten distress threshold (already deployed)

The old threshold triggered Opus + care routing on any negative valence + moderate arousal. Spreadsheet frustration activated it. The new threshold requires sustained negative valence or explicit distress content. This gives wit room to operate on turns where the user is mildly frustrated but not in genuine distress.

**Status: Deployed. Verify with Alice-type scenario.**

### Change 3: Early-wit permission in opener and first responses

For first-ever conversations where the user's opening message is light (greeting, casual question, exploratory), the policy selector should favour `playful-connecting` over `warm-reflective-connecting` for the first response. This gives Sonnet/Haiku the register that produces wit rather than the register that produces careful warmth.

```typescript
// In policy selection, for first-encounter users on light openings
if (
  calibration.relationalDepth === 'first_encounter' &&
  directive.communicativeIntent === 'connecting' &&
  directive.valence > 0 &&
  directive.emotionalArousal < 0.5
) {
  // Prefer playful over warm-reflective for the first light exchange
  preferredPolicy = 'playful-connecting';
  console.log('[policy] First encounter, light opening — favouring playful register');
}
```

This doesn't force wit. It just puts Jasper in the register where wit can emerge. If the user's first message is "Hey, nice to meet you" → playful register → Jasper has room to be sharp. If their first message is "I need help with something" → normal routing → no playful override.

### Change 4: Don't override playful register when care context isn't active

Currently, if the classifier detects any negative valence, the policy tends to shift toward warm-reflective. But mild negativity ("workplace politics drive me mad") isn't distress — it's the kind of content where observational wit works best. The warm-reflective policy suppresses the analytical sharpness that produces wit.

The gate: only shift to warm-reflective when the care context is actually injected (distress threshold crossed). If care context isn't active, allow playful and analytical policies to handle mildly negative content.

```typescript
// In policy selection
if (directive.valence < 0 && !careContextActive) {
  // Mild negativity without distress — don't force warm-reflective
  // Let the classifier's posture recommendation stand
  console.log('[policy] Negative valence but no distress — allowing non-care policy');
}
```

### Change 5: Track wit clusters

When wit is detected (via the laughter-signal method from Part 1), store a `wit_cluster_active` flag on the conversation state. While this flag is active (for the next 3-4 turns after a wit detection), slightly favour playful policies even if the intent shifts to sharing or sense_making. This sustains the cluster effect — once wit has landed, keep the register that allows more.

```typescript
// When wit is detected (user laughed)
conversationState.witClusterActive = true;
conversationState.witClusterTurnsRemaining = 4;

// On each subsequent turn
if (conversationState.witClusterActive) {
  conversationState.witClusterTurnsRemaining--;
  if (conversationState.witClusterTurnsRemaining <= 0) {
    conversationState.witClusterActive = false;
  }
}

// In policy selection
if (conversationState.witClusterActive && !careContextActive) {
  // Favour playful register to sustain the cluster
  preferredPolicy = policy.replace('warm-reflective', 'playful');
  console.log('[policy] Wit cluster active — sustaining playful register');
}
```

This is a light touch — it doesn't force wit, it just maintains the conditions that produced it for a few more turns. If the user shifts to serious content, the care routing overrides it. If they stay light, the cluster continues naturally.

---

## Observable in /observe

```
[policy] First encounter, light opening — favouring playful register
```

```
[policy] Negative valence but no distress — allowing non-care policy
```

```
[wit] Laughter detected in user message — marking previous turn as wit
[policy] Wit cluster active (3 turns remaining) — sustaining playful register
```

---

## Verification

### Behavioural analytics
1. Have a 10-turn conversation. Check turn_logs — correction_detected, disclosure_depth, user_initiated_topic, wit_detected should all be populated.
2. End the session. Check conversation analytics — behavioral metrics should appear in the analytics JSON.
3. Have a second conversation with the same user. Check session_gap_hours is computed correctly.

### Wit steering
1. Start a new clone conversation with a light opening ("Hey, what's up"). Verify policy is playful-connecting, not warm-reflective.
2. Say something mildly negative but not distressing ("work is annoying lately"). Verify policy doesn't force warm-reflective. Verify care context is NOT injected.
3. If Jasper says something funny and you respond with "ha" or "that's funny", verify the previous Jasper turn gets wit_detected=true in turn_logs.
4. Verify the next 3-4 turns maintain playful register (wit cluster effect).
5. Say something genuinely distressing. Verify care routing fires and overrides the playful register.

### Cold-start test
1. Create a fresh clone user.
2. Open with a light greeting.
3. Count: does Jasper attempt something sharp/witty in the first 3 turns?
4. If yes: does it land? Does the conversation develop differently than Alice's first session?
5. If no: check whether the playful policy was selected and whether the identity prompt's character description was present in the system prompt.
