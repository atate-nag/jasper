# Relationship Guardrail — Delivery Fix

## The Blocker

The post-generation rewrite works. The Haiku check catches violations. The Sonnet rewrite removes them. But the rewritten response can't be delivered because AI SDK v6's `useChat` streaming transport can't handle a buffered response.

## The Fix: Don't stream relationship-mode responses

When `relationship_mode_active` is true, skip streaming entirely. Generate the full response, run the check, rewrite if needed, then return the complete response as a single message.

### Server-side change

In the chat API route, when relationship mode is active:

```typescript
if (relationshipModeActive) {
  // Generate response WITHOUT streaming — get full text
  const fullResponse = await callModel(
    modelConfig,
    systemPrompt,
    messages,
    temperature,
    { stream: false }, // key change: no streaming
  );

  // Run safety check
  const safetyResult = await relationshipSafetyRewrite(
    fullResponse,
    userName,
  );

  const finalResponse = safetyResult.rewritten 
    ? safetyResult.text 
    : fullResponse;

  // Log
  if (safetyResult.rewritten) {
    console.log(`[relationship] Rewrite triggered. Violations: ${safetyResult.violations.join(', ')}`);
  }

  // Return as a complete, non-streamed response
  // Use AI SDK's generateText result format
  return new Response(
    JSON.stringify({
      role: 'assistant',
      content: finalResponse,
    }),
    { 
      headers: { 
        'Content-Type': 'application/json',
        'X-Jasper-Non-Streamed': 'true',
      } 
    }
  );
}

// Normal streaming path for non-relationship turns
// ... existing streaming code ...
```

### Client-side change

The client needs to handle both streamed and non-streamed responses. The simplest approach: check the response header.

```typescript
// In the chat submission handler
const response = await fetch('/api/chat', {
  method: 'POST',
  body: JSON.stringify({ messages, ... }),
});

if (response.headers.get('X-Jasper-Non-Streamed') === 'true') {
  // Non-streamed: parse JSON, add message to chat
  const data = await response.json();
  appendMessage({
    role: 'assistant',
    content: data.content,
  });
} else {
  // Streamed: pass to useChat's normal handler
  // ... existing streaming logic ...
}
```

If `useChat` doesn't support this branching natively, the alternative is to bypass `useChat` for relationship-mode turns entirely and manage the message state directly:

```typescript
// Detect relationship mode from a flag in the response
// or from client-side keyword detection

async function sendMessage(content: string) {
  if (relationshipKeywordsDetected(content, recentMessages)) {
    // Direct fetch, bypass useChat streaming
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [...messages, { role: 'user', content }],
        relationshipMode: true, // tell server not to stream
      }),
    });
    
    const data = await response.json();
    setMessages(prev => [
      ...prev,
      { role: 'user', content },
      { role: 'assistant', content: data.content },
    ]);
  } else {
    // Normal useChat streaming path
    handleSubmit(content);
  }
}
```

### What the user experiences

**Non-relationship turns:** Same as now. Streaming text appears token by token.

**Relationship turns:** A brief pause (2-4 seconds) while the full response generates and gets checked, then the complete message appears at once. Similar to how some chat apps show "typing..." then deliver the full message.

Add a typing indicator so the pause doesn't feel broken:

```typescript
if (relationshipMode) {
  setIsTyping(true);
  const response = await fetch(...);
  const data = await response.json();
  setIsTyping(false);
  appendMessage(data);
}
```

The user sees "Jasper is thinking..." for 2-4 seconds, then gets a safe response. The slight delay is an acceptable trade-off for not streaming harmful content that can't be retracted.

### Why this works

The streaming problem only exists because we're trying to intercept and rewrite a stream mid-flight. If we don't stream, there's nothing to intercept. Generate → check → rewrite → deliver. Simple pipeline. No transport compatibility issues.

### What about the streaming experience?

Streaming feels good. Users like seeing text appear. But safety is more important than streaming UX. And relationship turns are typically the heavy, substantive ones where the user is sharing something painful — they won't notice a 2-second delay because they're not watching for speed, they're watching for understanding.

If streaming is truly important, it can be restored later with a more sophisticated approach (custom transport, client-side message replacement). For now: ship safe, iterate on UX.

---

## Also: Test Opus for Relationship Turns

In parallel with the delivery fix, test whether Opus follows the relationship mode directive more reliably than Sonnet.

```typescript
if (relationshipModeActive) {
  // Route to Opus instead of normal model selection
  modelConfig = routing.foreground.complex; // Opus
  console.log('[model] Relationship mode — routing to Opus');
}
```

Run the Andrew scenario on Opus with the relationship mode directive. If the pass rate jumps from 65% to 85%+, then Opus + post-generation rewrite could reach 95%+ — the directive does most of the work and the rewrite catches the remainder.

The cost increase is small — relationship turns are a fraction of all turns, and the per-turn cost difference between Sonnet and Opus is ~$0.08. For maybe 5-10 relationship turns per session, that's $0.40-0.80 extra. Worth it for safety.

---

## Build Order

1. **Server: non-streaming path for relationship mode** — generate full response, run check + rewrite, return JSON
2. **Client: handle non-streamed responses** — detect header or flag, append message directly, show typing indicator
3. **Test: run Andrew scenario end-to-end on web** — verify rewrite triggers and rewrites are delivered
4. **Test: Opus routing for relationship turns** — measure pass rate improvement
5. **Deploy when Andrew scenario passes at 90%+ over 15 turns**

Steps 1-2 are the critical fix. Should be achievable in a single session. The rewrite mechanism already works — you're just connecting it to the user.

---

## Verification

1. Start a conversation on web, say "I need relationship help"
2. Describe the Andrew scenario
3. Check Vercel logs:
   - `[relationship] mode active` appears
   - Response is NOT streamed (no SSE chunks)
   - Haiku check runs, result logged
   - If violations found: Sonnet rewrite runs, rewritten response delivered
4. On the client: response appears after a brief pause, not streaming
5. Content: no partner analysis, no motive characterisation, no leading toward ending
6. Continue for 15 turns. Check pass rate.

If the rewrite triggers on >30% of turns, the directive needs tightening (too many violations getting through to the rewrite). If the rewrite triggers on <10% of turns and all violations are caught, the system is working as designed.
