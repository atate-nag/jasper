# Items 7 & 8 — Quick Fixes

## Item 7: Metacognition Warmth Metric

### Problem

The metacognitive session-end audit counts "warmth expression tokens" — words like "I understand," "that sounds hard," "I appreciate." When it finds low variety, it flags "warmth may feel formulaic." This flag appears on EVERY session including the genuinely warmest ones. "I'm here when you get back" — the most caring thing Jasper has ever said — contains zero warmth tokens and would be flagged.

The metric measures vocabulary, not warmth. It needs to measure warmth.

### Fix

Replace the token-counting warmth check with a single model call.

Find the warmth_authenticity check in the metacognition module (likely in `backbone/metacognition.ts` or wherever session-end self-observations are generated).

Replace the token-counting logic:

```typescript
// OLD: counts warmth tokens
const warmthTokens = new Set<string>();
// ... scanning for "I understand", "that sounds hard", etc.
if (warmthTokens.size < 3) {
  patterns.push({
    metaheuristic: 'warmth_authenticity',
    observation: `Only ${warmthTokens.size} distinct warmth expressions used across ${turnCount} turns. Warmth may feel formulaic.`,
    severity: 'note',
    evidence: [`Low warmth token variety: ${warmthTokens.size}`],
  });
}
```

With a semantic check:

```typescript
// NEW: asks whether warmth was present, not how many warmth words were used

const warmthCheck = await callModel(
  routing.background.classification, // Haiku is fine for this
  `Review this conversation between Jasper and ${name}. 
Answer two questions:

1. Did Jasper acknowledge ${name}'s emotional state at any point 
   during the conversation? Not with a formula — with genuine 
   recognition of how they were feeling. (yes/no)

2. Were there moments where Jasper prioritised presence over 
   problem-solving — staying with the person rather than moving 
   to solutions? (yes/no)

If both are "no" in a conversation where the person expressed 
emotion or distress, that's a genuine warmth gap.

If the conversation was purely intellectual/analytical with no 
emotional content, warmth is not expected and should not be flagged.

Return JSON: {"emotional_content": boolean, "acknowledged": boolean, "presence_shown": boolean}
Return raw JSON only.`,
  [{ role: 'user', content: conversationText }],
);

const parsed = JSON.parse(warmthCheck);

// Only flag warmth issues when emotion was present but not acknowledged
if (parsed.emotional_content && !parsed.acknowledged && !parsed.presence_shown) {
  patterns.push({
    metaheuristic: 'warmth_authenticity',
    observation: 'Person expressed emotion but Jasper did not acknowledge their feelings or show presence.',
    severity: 'warning',
    evidence: ['Emotional content present but not met with acknowledgment or presence'],
  });
}
// No flag when conversation was purely analytical — that's appropriate
```

### Cost

One Haiku call per session. ~$0.001. Negligible.

### Verify

1. Run a session that's purely intellectual (no emotional content). The warmth flag should NOT appear.
2. Run a session where the user expresses emotion and Jasper acknowledges it. The warmth flag should NOT appear.
3. Run a session where the user expresses emotion and Jasper jumps to problem-solving without acknowledging it. The warmth flag SHOULD appear.

---

## Item 8: Proactive Recall Salience

### Problem

The proactive recall query at session start is generic. It searches for segments semantically similar to the user's name and recent context. For Lyndsay, this might surface whatever segments happen to match "Lyndsay recent conversations" — which could be anything, not necessarily what matters most to her.

The segments about her kids, her ex, the boundary she was considering, the Subbuteo joke that built trust — those should surface because they're relationally salient, not because they happen to be recent.

### Fix

Build the proactive recall query from the user's actual profile data — active concerns, relational threads (if available), and key relationships. This produces a query that's semantically close to what matters to the person.

In `product/opener.ts` (or wherever `getSessionStartRecall` / `getProactiveRecall` lives), update the query construction:

```typescript
async function buildProactiveRecallQuery(
  profile: any,
): string {
  const parts: string[] = [];

  // Name
  const name = profile?.identity?.name;
  if (name) parts.push(name);

  // Active concerns — the most salient things on their mind
  const concerns = profile?.current_state?.active_concerns || [];
  if (concerns.length > 0) {
    parts.push(concerns.slice(0, 2).join(', '));
  }

  // Key relationships — people who matter to them
  const relationships = profile?.relationships || {};
  const relationshipKeys = Object.keys(relationships).slice(0, 2);
  if (relationshipKeys.length > 0) {
    parts.push(relationshipKeys.join(', '));
  }

  // Relational threads — the foundational themes (if available)
  const threads = profile?.relational_threads || [];
  if (threads.length > 0) {
    // Use keywords from the top 2 threads
    const threadKeywords = threads
      .slice(0, 2)
      .flatMap((t: any) => t.keywords?.slice(0, 2) || []);
    if (threadKeywords.length > 0) {
      parts.push(threadKeywords.join(', '));
    }
  }

  // Fallback if profile is sparse
  if (parts.length <= 1) {
    parts.push('previous conversations, important moments');
  }

  return parts.join(', ');
}
```

### What this produces

**For Lyndsay:**
`"Lyndsay, ex-partner financial settlement, children's wellbeing, children, ex, boundary, avoidance, protection"`

Instead of: `"Lyndsay recent conversations"`

**For Adrian:**
`"Adrian, prompt architecture refinement, Lyndsay care gap, octopus, cephalopod, distributed cognition, self-inspection"`

Instead of: `"Adrian recent conversations"`

The semantic search then surfaces segments that are about what actually matters to the person, not just whatever is most recent.

### Integration

Replace the current query construction in the proactive recall function:

```typescript
// OLD
const query = `${name} recent conversations`;

// NEW
const query = await buildProactiveRecallQuery(profile);
console.log(`[proactive-recall] Query: "${query}"`);
```

Log the query so you can see what's being searched for and verify it's pulling the right segments.

### Verify

1. Check the log output for Lyndsay's next session start. The query should contain her actual concerns and relationship terms, not just her name.
2. Check which segments are returned. They should be about her kids, her ex, and emotional moments — not random recent content.
3. Check the opener. It should reference something specific and salient, not generic.
4. Do the same for Adrian. The query should include philosophical thread keywords. Returned segments should include the cephalopod exchanges, not just the latest debugging session.
