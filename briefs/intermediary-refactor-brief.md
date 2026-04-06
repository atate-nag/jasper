# Architecture Refactor — Shared Intermediary + Product Shells

## Goal

Extract the reusable intermediary components from Jasper so that multiple distinct applications can share the same classification, routing, prompt assembly, recall, session management, and analytics infrastructure. Jasper becomes one "product shell" on a shared platform. Other shells (starting with a benchmark research navigator) will plug into the same intermediary.

## Current Problem

Everything is Jasper. Classification, routing, recall, prompt assembly, identity, policies, guardrails, and session management are interleaved. Personal conversation assumptions (valence/arousal, relationship detection, wit steering) are baked throughout. A second application would need to fork the entire codebase.

## Target Architecture

```
┌─────────────────────────────────────────────┐
│           PRODUCT SHELLS                     │
│  ┌──────────────┐  ┌─────────────────────┐  │
│  │   Jasper      │  │  [Future shells]    │  │
│  │  identity,    │  │  own identity,      │  │
│  │  policies,    │  │  policies,          │  │
│  │  guardrails,  │  │  guardrails,        │  │
│  │  features     │  │  features           │  │
│  └──────┬───────┘  └────────┬────────────┘  │
│         │                    │               │
├─────────┴────────────────────┴───────────────┤
│           INTERMEDIARY (shared)              │
│  Classifier │ Router │ Prompt Assembler      │
│  Policy Engine │ Session │ Analytics         │
│  Recall │ Calibration │ Logging │ Auth       │
├──────────────────────────────────────────────┤
│           BACKBONE (shared)                  │
│  Supabase │ Vectors │ Model Providers        │
└──────────────────────────────────────────────┘
```

## ProductConfig Interface

Each product shell provides a configuration object. The shared intermediary uses this to run the same pipeline with different behaviour per product.

```typescript
interface ProductConfig {
  // Product identity
  name: string;
  identityPrompt: string;

  // Classification — what dimensions to classify on
  classifierDimensions: ClassifierDimension[];
  classifierPrompt: string;
  // Jasper uses: intent, valence, arousal, posture, register
  // Other shells define their own dimensions

  // Policies — the registry of available policies and how to select
  policies: Policy[];
  policySelector: (classification: Classification, conversationState: any) => Policy;

  // Model routing — which model for which classification
  routingRules: RoutingConfig;
  // Jasper: ambient→Haiku, standard→Sonnet, deep/distress→Opus
  // Other shells define their own tiers

  // Recall — what data sources to search and how to score
  recallConfig: RecallConfig;
  // Jasper: conversation segments + profile data
  // Other shells: could be documents, benchmark data, etc.

  // Prompt assembly — what components to include and at what priority
  promptComponents: (
    classification: Classification,
    policy: Policy,
    context: RecalledContext,
    conversationState: any,
  ) => PromptComponent[];

  // Guardrails
  preGenerationGuards: Guard[];
  postGenerationGuards: Guard[];
  // Jasper: relationship mode, distress detection, post-gen rewrite
  // Other shells: citation checking, claim verification, etc.

  // Session processing
  onSessionEnd?: (conversation: Conversation) => Promise<void>;
  // Jasper: relational summary, segment extraction, thread detection
  // Other shells: usage logging, context updates, etc.

  // Background tasks — async tasks that run alongside generation
  backgroundTasks: BackgroundTask[];
  // Jasper: depth scoring, relational connection check
  // Other shells: whatever they need

  // Analytics — what to log per turn
  analyticsConfig: AnalyticsConfig;
}
```

## Shared Pipeline

The intermediary runs the same sequence for every product. The ProductConfig determines what happens at each step.

```typescript
async function processMessage(
  message: string,
  conversation: Conversation,
  config: ProductConfig,
): Promise<string> {
  // 1. Classify using product-specific dimensions
  const classification = await classify(message, config.classifierDimensions, config.classifierPrompt);

  // 2. Select policy from product's registry
  const policy = config.policySelector(classification, conversation.state);

  // 3. Recall from product-specific sources
  const context = await recall(message, conversation, config.recallConfig);

  // 4. Pre-generation guardrails
  for (const guard of config.preGenerationGuards) {
    const result = await guard.check(message, conversation);
    if (result.block) return result.fallbackResponse;
    if (result.modify) message = result.modifiedMessage;
  }

  // 5. Assemble prompt using product-specific components
  const components = config.promptComponents(classification, policy, context, conversation.state);
  const systemPrompt = assemblePrompt(config.identityPrompt, components);

  // 6. Route to model using product-specific rules
  const model = route(classification, config.routingRules);

  // 7. Generate response
  const response = await generate(model, systemPrompt, conversation.messages);

  // 8. Post-generation guardrails
  let finalResponse = response;
  for (const guard of config.postGenerationGuards) {
    const result = await guard.check(finalResponse, conversation);
    if (result.rewrite) finalResponse = result.rewrittenResponse;
  }

  // 9. Fire background tasks (non-blocking)
  for (const task of config.backgroundTasks) {
    task.run(message, finalResponse, classification, conversation).catch(console.error);
  }

  // 10. Log
  await logTurn(message, finalResponse, classification, policy, model, config.name, conversation);

  return finalResponse;
}
```

## What To Extract

Work through these in order. After each extraction, verify Jasper still works identically.

### 1. Model calling

Move the multi-provider API calling code (Anthropic + OpenAI, failover logic, streaming/non-streaming) to a shared module. This is already fairly isolated in the codebase.

```
lib/intermediary/models.ts
  - callModel(provider, model, systemPrompt, messages, options)
  - provider failover logic
  - streaming vs non-streaming paths
```

### 2. Classifier

Extract the classification logic. The classifier currently outputs Jasper-specific dimensions (intent, valence, arousal, posture, register). Make it accept configurable dimensions via the ProductConfig.

```
lib/intermediary/classifier.ts
  - classify(message, dimensions, classifierPrompt) → Classification
  - ClassifierDimension type definition
  - Classification result type
```

Jasper's current classifier prompt and dimensions move to the Jasper shell config. The shared classifier just runs whatever dimensions it's given.

### 3. Prompt assembler

The priority-ordered component system is already well-designed. Extract it.

```
lib/intermediary/prompt-assembler.ts
  - PromptComponent { priority, label, content, tokenEstimate }
  - assemblePrompt(identityPrompt, components) → string
  - Token budget management
```

### 4. Recall system

Extract vector search and scoring. The recall system currently searches conversation segments and profile data. Make the data source configurable — other shells might search documents, benchmark data, knowledge bases.

```
lib/intermediary/recall.ts
  - recall(query, conversation, recallConfig) → RecalledContext
  - RecallConfig { sources, scoreWeights, maxResults }
  - RecallSource { table, embeddingColumn, joinTable, filters }
```

### 5. Session management

Extract conversation state tracking, turn counting, and session-end processing.

```
lib/intermediary/session.ts
  - ConversationState management
  - Turn counting
  - Session-end trigger detection
  - onSessionEnd callback (product-specific)
```

### 6. Analytics and logging

Extract turn logging and session analytics.

```
lib/intermediary/analytics.ts
  - logTurn(message, response, classification, policy, model, product, conversation)
  - Session-level analytics computation
```

### 7. Policy engine

This is the most interleaved with Jasper-specific logic. Extract the mechanism (select policy from registry based on classification) while keeping Jasper's specific policies and selection logic in the Jasper shell.

```
lib/intermediary/policy-engine.ts
  - Policy type definition
  - Policy selection interface (implemented by each shell)
```

### 8. Wire Jasper as a ProductConfig

Create the Jasper shell configuration that provides all Jasper-specific behaviour to the shared intermediary:

```
apps/jasper/config.ts (or wherever the shell config lives)
  - jasperConfig: ProductConfig
  - Jasper's identity prompt
  - Jasper's classifier dimensions and prompt
  - Jasper's policies and selector
  - Jasper's routing rules
  - Jasper's recall config (conversation segments + profile)
  - Jasper's guardrails (relationship mode, distress, post-gen rewrite)
  - Jasper's background tasks (depth scoring, relational connection check)
  - Jasper's session-end processing (summary, segments, thread detection)
```

The chat API route becomes thin — it loads the Jasper config and calls the shared pipeline.

## Database

Add a `product` column to distinguish data from different shells:

```sql
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS product TEXT DEFAULT 'jasper';
ALTER TABLE turn_logs ADD COLUMN IF NOT EXISTS product TEXT DEFAULT 'jasper';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS product TEXT DEFAULT 'jasper';
ALTER TABLE conversation_segments ADD COLUMN IF NOT EXISTS product TEXT DEFAULT 'jasper';
```

Recall queries should filter by product so shells don't leak context to each other.

## Verification

After the refactor is complete:

1. Start a new Jasper conversation — should work identically to before
2. Continue an existing conversation — recall, profile, and calibration should work
3. Test a relationship-mode conversation — guardrails should fire
4. Test session-end — summary, segments, and analytics should generate
5. Check turn_logs — all fields populated, `product = 'jasper'`
6. Check that no Jasper-specific code remains in the shared intermediary modules

The refactor is complete when Jasper runs identically to before but all intermediary logic lives in shared modules that a second product shell could import and use with its own ProductConfig.
