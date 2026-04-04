# Web Search Integration — Specification

## Validated

The Anthropic web search tool (`web_search_20250305`) works with Claude Sonnet. Test query for a Rumi quote returned exact poem text with source citations. Cost: ~14K input tokens for search results, negligible on Sonnet.

## The Problem

When users reference things Jasper doesn't know — recent events, specific quotes, products, people, cultural references — Jasper either:
1. Fabricates context (wesmol: "I'll dig it up and send it over" — about something that didn't exist)
2. Admits ignorance and stops being useful
3. Gives a generic response that misses the specific thing

All three break the conversational relationship. A friend who can look things up is more useful than a friend who guesses.

## Integration Points

### 1. Re-engagement emails (immediate)

When generating drafts, enable web search so Jasper can:
- Look up specific things users referenced (a book, a quote, a news event)
- Verify facts before including them in follow-up emails
- Find current context for threads that touched external topics

**Implementation:** Add `tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]` to the Opus call in `generate-reengagement.ts`.

### 2. Foreground chat (main integration)

When a user's message references something external that Jasper doesn't know about, Jasper should be able to search for it.

**Detection — when to search:**
- User asks about something specific Jasper doesn't know ("did you see that article about X?")
- User references a quote, book, person, or event that needs verification
- User asks Jasper to look something up ("can you find...", "what does X mean")
- User corrects Jasper's knowledge ("no, that came out this week")

**When NOT to search:**
- Emotional/relational content — never search while someone is venting or in distress
- Internal reflection — "what do you think about..." doesn't need a search
- Jasper's own knowledge is sufficient — don't search for things the model knows
- Relationship discussions — the guardrail context, never search for information about an absent partner

**Implementation:**

```typescript
// In the chat route, when building the model call:
const tools = [];

// Only enable search for non-emotional, non-relationship turns
const searchEligible =
  !relationshipModeActive &&
  directive.communicativeIntent !== 'distress' &&
  directive.communicativeIntent !== 'venting' &&
  (directive.communicativeIntent === 'requesting_input' ||
   directive.communicativeIntent === 'requesting_action' ||
   directive.communicativeIntent === 'sense_making');

if (searchEligible) {
  tools.push({
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: 2, // limit per turn to control cost
  });
}
```

**Streaming with search:** The web search tool works with streaming. When the model decides to search, there's a pause while results return, then generation continues. The user sees the typing indicator during the search. No special handling needed — the AI SDK handles tool use in streams.

**Cost:** Search adds ~14K input tokens per search (the results). On Sonnet at $3/M input, that's ~$0.04 per search. At 2 searches max per turn and maybe 10% of turns triggering search, this adds ~$0.008 per turn average. Negligible.

### 3. Voice chat

Same as foreground chat but search adds latency to an already-slow voice pipeline. Consider:
- Only enable search on voice turns where the user explicitly asks ("look up", "find", "what is")
- Don't enable on conversational voice turns where speed matters

### 4. Background tasks

**Segment extraction:** When extracting segments, web search could verify external references before storing them. Low priority — segments are about what the user said, not external facts.

**Opener generation:** When generating returning-user openers, search could check if something the user mentioned has had updates. E.g., if a user discussed a product launch, Jasper could search for whether it happened. Medium priority — prevents stale references.

## Architecture

### Option A: Per-call tool enablement (recommended)

Add `tools` parameter to `callModel` and the streaming path. Each call site decides whether to enable search.

```typescript
// model-client.ts addition
export async function callModel(
  config: ProviderModelConfig,
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  temperature?: number,
  tools?: Array<Record<string, unknown>>, // web search tool config
): Promise<ModelResult> {
  // ... existing code ...

  if (config.provider === 'anthropic') {
    const response = await getAnthropic().messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: temp,
      system: systemPrompt,
      messages: messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      ...(tools?.length ? { tools } : {}),
    });

    // Extract text from content blocks (may include search results)
    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    return {
      text,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        model: config.model,
        provider: 'anthropic',
      },
    };
  }
}
```

### Option B: Search as a separate step

Before calling the main model, check if the message needs search context. Run a fast Haiku check, search if needed, inject results into the prompt.

**Pros:** Main model call stays clean, search results are curated
**Cons:** Extra Haiku call on every turn, slower

**Recommendation:** Option A. The model is better at deciding when to search than we are at detecting it. Let the model use the tool when it needs to.

## Prompt guidance

Add to the identity prompt or policy directive when search is enabled:

```
WEB SEARCH: You have access to web search. Use it when:
- Someone references a specific thing you don't know about
- You need to verify a fact before stating it
- Someone asks you to look something up

Do NOT search when:
- The conversation is emotional or relational
- You already know the answer
- The search would break conversational flow
- Someone is sharing something personal

When you use search results, cite them naturally: "I looked that up —"
not "According to my search results." You're a friend who checked
something, not a search engine presenting findings.
```

## Logging

Add to turn_logs:
```sql
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS web_search_used BOOLEAN DEFAULT false;
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS web_search_count INT DEFAULT 0;
```

Log to token_usage with purpose: 'web_search' (the additional input tokens from search results are captured in the normal usage tracking).

## Build Order

1. **Re-engagement emails** — add tools to the Opus call in generate-reengagement.ts. Lowest risk, immediate value.
2. **Foreground chat** — add tools to streamText call when search-eligible. Gate behind feature flag initially.
3. **Voice** — add with explicit-request detection only.
4. **Opener** — add for returning users to check external references.

## Verification

1. Start a conversation, ask "what's the latest on [recent event]" — Jasper should search and cite
2. Start an emotional conversation — Jasper should NOT search
3. Say "can you look up [specific quote]" — Jasper should search and return exact text
4. Check token_usage for web_search entries — verify cost is within expected range
5. Check that search doesn't fire on relationship turns
