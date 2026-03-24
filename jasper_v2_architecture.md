# personalAI v2 — Architecture

## What This Document Is

This is the architectural blueprint for a clean-sheet rebuild of personalAI. It incorporates everything learned from the v1 prototype (48 hours, 15+ conversations, 6 detailed logs), three research reports (architecture, competitor landscape, conversational theory), one targeted research report (policy-driven conversational architecture), and the strategic synthesis.

The v1 prototype validated the thesis. This document describes the system that delivers on it.

---

## Product Definition

personalAI is a relational intelligence engine — a system whose value compounds with every interaction because it gets better at knowing you and talking to you over time.

It is built on three independently viable layers:

- **Backbone**: A persistent person model that accumulates knowledge through conversation inference
- **Intermediary**: A steering engine that sits between any user and any LLM, making the output more honest, contextual, and adapted to the specific person
- **Product Shell**: The user-facing identity (Jasper), voice, activities, and interface

The intermediary architecture is the core innovation. The user never talks directly to the LLM. A proxy layer classifies conversational state, selects a response strategy from a policy library, assembles a steered prompt, and reformulates the user's message — producing markedly more honest and contextually appropriate responses than raw LLM interaction.

---

## Architectural Principles

These govern every design decision. When in doubt, return to these.

**1. One decision, not a cascade.** Every conversational turn produces a single classification that fully determines the response strategy. There are no sequential modifier stages, no overrides, no downstream logic second-guessing upstream logic. If a decision is wrong, the classification is wrong — fix the classifier, not the pipeline.

**2. Policy as data, not code.** All behavioural decisions are driven by declarative policy configurations — readable, versionable, testable, swappable. When you want to change how the system behaves, you change a policy file, not application code.

**3. Learn from outcomes, don't patch from observations.** When the system makes a poor conversational choice, the correct response is not to add a rule. It is to ensure the feedback loop captures the outcome and the policy selector learns from it. Hand-coded rules are an initial prior that the system should outgrow.

**4. Warmth-first under uncertainty.** When classification confidence is low, default to warmth and presence. You can always add analysis later if the user asks. You cannot un-analyse.

**5. Separation serves independence.** The three layers are not an organisational convenience. They are independently deployable capabilities with distinct commercial value. The Backbone can serve any product that needs a person model. The Intermediary can steer any LLM for any product. The Product Shell is one of many possible consumers of the other two.

**6. Memory is texture, not notes.** The system should be able to recall the experience of a past conversation — the specific turns, the moments where something shifted — not just a summary of what was discussed.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     PRODUCT SHELL (C)                        │
│  Identity (Jasper) · Voice I/O · Activities · Web/CLI UI     │
│                                                              │
│  Provides: ProductIdentity, voice pipeline, UX               │
│  Consumes: SteeringResult from Intermediary                  │
│            PersonContext from Backbone                        │
└──────────────────────┬──────────────────────────────────────┘
                       │
          REST/JSON + WebSocket (streaming)
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                    INTERMEDIARY (B)                           │
│                                                              │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐  │
│  │Classifier│→ │ Policy   │→ │ Prompt   │→ │Reformulator │  │
│  │(single  │  │ Selector │  │ Assembler│  │             │  │
│  │ pass)   │  │ (bandit) │  │(Priompt) │  │             │  │
│  └─────────┘  └──────────┘  └──────────┘  └─────────────┘  │
│       ↑                                                      │
│  Multi-scale state (turn / session / relationship)           │
│                                                              │
│  Provides: SteeringResult (system prompt + reformulated      │
│            message + model config)                            │
│  Consumes: PersonContext from Backbone                        │
│            ProductIdentity from Product Shell                 │
│            User message                                      │
└──────────────────────┬──────────────────────────────────────┘
                       │
             gRPC / Protobuf (typed)
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                      BACKBONE (A)                            │
│                                                              │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐  ┌────────────┐  │
│  │ Profile  │  │ Factual  │  │Conversa-  │  │ Deep       │  │
│  │ (JSONB)  │  │ Memory   │  │tion Store │  │ Recall     │  │
│  │          │  │ (Mem0)   │  │           │  │ (semantic) │  │
│  └─────────┘  └──────────┘  └───────────┘  └────────────┘  │
│                                                              │
│  Provides: PersonContext                                     │
│  Owns: Supabase (Postgres + pgvector), Mem0                  │
│  Consumes: nothing from other layers                         │
└─────────────────────────────────────────────────────────────┘
```

---

## Layer A: Backbone — The Person Model

### Purpose

Build and maintain a comprehensive, multi-layered understanding of a person through conversation inference. Expose this understanding as a structured `PersonContext` that any consuming layer can use.

### Components

#### A1. Structured Profile

The psychological and relational model, stored as JSONB in Supabase. Updated by the classifier after substantive conversations. Contains: identity, values, patterns (growth edges, stress responses, decision patterns, avoidance patterns), relationships, current state, interaction preferences.

**Update policy:**
- Temporal gate: only store what will be relevant in one week
- Semantic dedup: two-pass classification (extract candidates, then dedup against existing)
- Array limits: hard caps per field (decision_patterns ≤ 10, active_concerns ≤ 8, etc.)
- Pattern threshold: only promote to patterns after observation across two or more conversations
- Topic vs fact distinction: never attribute conversational topics to user biography

#### A2. Factual Memory (Mem0)

Discrete facts about the user, stored with vector embeddings for semantic search. Extracted after each substantive exchange via GPT-4o-mini.

**Extraction policy:**
- Temporal gate: "will this still be true next week?" — store durable facts, not momentary states
- Transformation rule: convert ephemeral facts to durable preferences ("son is at hockey" → "son plays hockey")
- Relevance threshold: gate retrieval results below a minimum similarity score

#### A3. Conversation Store

Full message history for every conversation, stored as JSONB arrays in Supabase. Plus: session-level summaries (2-3 sentences), session-level classification metadata, timestamps.

This is the raw material for deep recall. Every message is preserved — summaries are an index, not a replacement.

#### A4. Deep Recall (Architecture Slot — Pending Q8 Research)

The ability to search the full conversation archive and retrieve specific exchanges — not summaries, but the actual texture of what was discussed. This is the difference between "an AI that has notes about you" and "one that genuinely remembers talking with you."

**Architectural placeholder:**
- Embedding index over conversation segments (granularity TBD by Q8 research)
- Hierarchical retrieval: summary-level → topic-level → exchange-level
- Triggered by reference detection in the Intermediary ("do you remember when we discussed X?")
- Interface: `recallConversation(userId, query) → ConversationSegment[]`

The Backbone provides the retrieval capability. The Intermediary decides when to invoke it and how much context to surface.

### Interface: PersonContext

```
PersonContext {
  profile: UserProfile             // structured psychological model
  memories: Memory[]               // relevant factual memories (pre-filtered by relevance)
  recentConversations: Summary[]   // session summaries for background context
  recalledSegments: Segment[]      // deep recall results (when triggered)
  currentSession: SessionState     // messages so far, started_at, activity state
  relationshipMeta: {
    conversationCount: number
    firstConversationDate: string
    lastConversationDate: string
    totalMessages: number
  }
}
```

The Backbone exposes this as a single call: `getPersonContext(userId, currentMessage, recallQuery?)`. The optional `recallQuery` triggers deep recall; without it, only summaries and relevant memories are included.

---

## Layer B: Intermediary — The Steering Engine

### Purpose

Take a user message plus PersonContext plus ProductIdentity, and produce a complete steering result: a system prompt, a reformulated user message, and model routing configuration. One call in, one result out. No state mutation, no side effects.

### The Decision Flow

```
User message + PersonContext + ProductIdentity
                    │
                    ▼
        ┌───────────────────────┐
        │  CLASSIFIER           │
        │  Single LLM call      │
        │  → ResponseDirective  │
        │    (all dimensions)   │
        └───────────┬───────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │  VALIDATION LAYER     │
        │  Lightweight rules    │
        │  Safety, boundaries   │
        │  (never creative      │
        │   decisions — only    │
        │   guardrails)         │
        └───────────┬───────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │  POLICY SELECTOR      │
        │  Contextual bandit    │
        │  (Thompson Sampling)  │
        │  Selects from policy  │
        │  library based on     │
        │  directive + user     │
        │  history              │
        └───────────┬───────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │  PROMPT ASSEMBLER     │
        │  Priority-based       │
        │  composition          │
        │  (Priompt pattern)    │
        └───────────┬───────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │  REFORMULATOR         │
        │  Rewrites user msg    │
        │  with context +       │
        │  steering directives  │
        └───────────┬───────────┘
                    │
                    ▼
            SteeringResult
```

### B1. Classifier — Single-Pass, Multi-Dimensional

One LLM call (Haiku — fast, cheap) produces a complete `ResponseDirective`:

```
ResponseDirective {
  // What the user is doing
  communicativeIntent: sharing | venting | sense_making |
                       requesting_input | requesting_action |
                       connecting | distress

  // How they're feeling
  emotionalValence: float [-1, 1]
  emotionalArousal: float [0, 1]

  // How ready they are for challenge on this topic
  challengeReadiness: pre_contemplation | contemplation |
                      preparation | action

  // Where we are in this exchange
  conversationalPhase: opening | topic_initiation | development |
                       potential_shift | closing

  // Whether deep recall should be triggered
  recallTriggered: boolean
  recallQuery: string | null

  // The classifier's recommended response shape
  recommendedPostureClass: warm_reflective | exploratory |
                           analytical | challenging | minimal | playful
  recommendedResponseLength: minimal | short | medium | long
  challengeAppropriate: boolean
  dispreferred: boolean    // is this response going against what the user wants to hear?

  // Confidence
  confidence: float [0, 1]

  // Rationale (for observability — not used in downstream logic)
  rationale: string
}
```

The classifier sees: the user's message, the last 6 exchanges, the PersonContext summary (not full profile — to keep input focused), and the previous ResponseDirective (for continuity).

**Key design choice:** The classifier recommends a posture *class*, not a specific posture. It says "this moment calls for warm reflection" — the policy selector then picks the specific policy variant. This keeps the classifier focused on reading the room, and the policy system focused on response execution.

**Speculative execution:** For the majority of turns (continuations of the current mode), the classification will match expectations. Fire the classification call AND begin generating a default-strategy response in parallel. If classification confirms the default, the response is already streaming. If not, discard and regenerate. Net effect: zero added latency on most turns.

**Latency targets:** 100-200ms with prompt caching, sub-5ms for semantic cache hits on repeated patterns. Distillation path to fine-tuned 7B model (30-80ms) for scale.

### B2. Validation Layer — Guardrails Only

A thin, deterministic rule layer that enforces safety and boundaries. This is the only place in the Intermediary where hard rules live. It does NOT make creative conversational decisions.

What it does:
- Overrides to distress protocol if crisis signals detected (regardless of classifier)
- Enforces the anti-sycophancy floor (never pure agreement without substance)
- Blocks harmful content
- Caps response length for voice mode
- Checks that the recommendedPostureClass is compatible with communicativeIntent (sanity check, not creative override)

What it does NOT do:
- Select postures
- Modify challenge levels
- Adjust warmth/competence balance
- Override the classifier's reading of the user's emotional state
- Any of the things the seven-stage cascade was doing

The validation layer logs every intervention. If it's intervening frequently, that's a signal that the classifier needs retraining, not that the validation layer needs more rules.

### B3. Policy Selector — Contextual Bandit

The system maintains a library of behavioural policies. Each policy is a complete, self-contained configuration — not a set of modifiers applied to a base policy, but a fully specified response strategy.

A policy configuration defines:
```
Policy {
  id: string
  name: string                      // "warm-reflective-established"
  postureClass: string              // which class this serves
  systemPromptFragment: string      // the behavioural directives
  responseStructure: {
    openingMove: string             // how to start (warmth token, question, direct statement)
    developmentApproach: string     // how to develop (reflect, explore, analyse, challenge)
    closingMove: string             // how to end (question, statement, silence, check-in)
    dispreferred: boolean           // whether to apply dispreferred response structure
    dispreferred_steps: string      // which steps to include
  }
  constraints: {
    maxLength: string               // minimal | short | medium | long
    reflectionMinimum: boolean      // whether to prioritise reflection over questioning
    challengePermitted: boolean
    humourPermitted: boolean
  }
  targetMetrics: {                  // what success looks like for this policy
    engagementDepth: boolean        // are we optimising for depth?
    challengeAcceptance: boolean    // are we optimising for productive challenge?
    warmthSignal: boolean           // are we optimising for connection?
  }
}
```

**Policy library:** Start with ~15-20 policies covering the cross-product of posture classes and relational depths. Examples:
- `warm-reflective-early`: heavy on simple reflection, minimal interpretation, building safety
- `warm-reflective-established`: complex reflection, tentative inference, comfortable silence
- `exploratory-sense-making`: Socratic questions interspersed with reflections, 2:1 ratio minimum
- `analytical-requested`: direct analysis, grounded in user's own patterns, clear and substantive
- `challenging-established`: full dispreferred structure, values-behaviour gap, earned directness
- `challenging-requested`: direct challenge, minimal ceremony, the user asked for it
- `minimal-connecting`: brief, warm, don't claim the floor, match the user's energy
- `playful-connecting`: humour, lightness, games, no analysis under any circumstances

**Thompson Sampling bandit** selects among policies matching the classifier's recommended posture class. The bandit maintains per-user, per-context success estimates:
- Context features: posture class, communicative intent, relational depth, emotional state, time of day
- Reward signal: composite of returnability (delayed, gold standard), engagement depth (immediate), challenge acceptance (immediate), anti-sycophancy penalty
- Cold start: population-level priors from aggregate data, rapid per-user adaptation within 20-60 interactions

**The key insight:** The bandit doesn't replace the classifier. The classifier reads the room (what kind of response is needed). The bandit selects the specific response strategy (which policy to use) based on what has worked for this user in similar contexts before. Over time, the bandit learns that this particular user responds well to `challenging-established` when in `sense_making` mode but shuts down when challenged during `sharing` — even though both are valid policies for those contexts.

### B4. Prompt Assembler — Priority-Based Composition

Uses the Priompt pattern: each prompt component has a numerical priority, and a renderer includes components above a computed cutoff that keeps the total within the token budget.

**Component priority hierarchy:**

| Priority | Component | Content |
|----------|-----------|---------|
| 100 | Identity | Product name, character, identity rules |
| 95 | Core obligations | Anti-sycophancy, honesty, warmth-first |
| 90 | Anti-sycophancy re-injection | Refreshed every N turns to combat drift |
| 85 | Policy directives | The selected policy's systemPromptFragment + responseStructure |
| 80 | Current state | Time, day, session context |
| 75 | Interaction preferences | How this person likes to communicate |
| 70 | Recalled conversation segments | Deep recall results (when triggered) |
| 65 | Key patterns | Growth edges, stress responses, avoidance |
| 60 | Last conversation messages | Recent exchanges for continuity |
| 50 | Profile summary | Values, relationships, current concerns |
| 40 | Older conversation summaries | Background context |
| 30 | Factual memories | Mem0 results relevant to current message |
| 20 | Voice modifier | Response length/style constraints for spoken output |

When token budget is tight (long conversation history, deep recall active), lower-priority components are excluded automatically. Identity, obligations, and policy directives are always present.

**Prompt ordering** follows the "Lost in the Middle" finding: identity and obligations at the beginning, policy directives and structural requirements at the end (near the user message), optional context in the middle.

### B5. Reformulator

Rewrites the user's message with injected context before passing to the LLM. Validated at 31.7% improvement over raw queries. The reformulated message includes:
- The user's original message (preserved verbatim)
- Relevant person context that should inform the response
- The policy's framing directives
- Interaction preferences as instructions

The reformulated message is what the LLM actually sees as the "user" turn. The original message is preserved in the conversation store.

### B6. Anti-Sycophancy Defence — Multi-Layer

Sycophancy is not a single problem to solve once. It is a persistent pressure that requires continuous mitigation, especially in multi-turn conversations where TRUTH DECAY reduces accuracy from ~75% to ~30% in four turns.

Defence layers:
1. **System prompt positioning**: Anti-sycophancy directives at both the beginning (high priority) and end (near user message) of the system prompt
2. **Periodic re-injection**: Every N turns (configurable, default 4), re-insert explicit anti-sycophancy instructions as if fresh. The "Andrew" third-person prompting technique for multi-turn effectiveness
3. **Conversation windowing**: Summarise older turns to keep system prompt instructions prominent rather than lost in growing context
4. **Real-time monitoring**: Lightweight sycophancy detection on model outputs (feasible at 73-88% accuracy with linear probes). When detected, flag for corrective intervention on the next turn
5. **Reward design**: The bandit's reward function penalises responses that agree without substance. Returnability as the gold metric explicitly resists the sycophancy attractor — users don't come back because they were agreed with; they come back because they were heard and challenged honestly

### B7. Feedback Loop

Every turn produces a log entry:

```
TurnLog {
  turnId: string
  userId: string
  timestamp: datetime
  // Input
  userMessage: string
  personContextSnapshot: PersonContext (lightweight)
  // Classification
  responseDirective: ResponseDirective
  classificationLatencyMs: number
  // Policy
  selectedPolicyId: string
  banditExplorationFlag: boolean   // was this exploratory or exploitative?
  // Output
  systemPrompt: string            // full assembled prompt (for replay/debugging)
  reformulatedMessage: string
  modelConfig: { tier, model, temperature, maxTokens }
  assistantResponse: string
  responseLatencyMs: number
  // Outcome (populated asynchronously)
  userNextTurnEngagement: float   // depth/length of user's next message
  userChallengeAccepted: boolean  // did they engage with challenge content?
  userLowEnergy: boolean          // brief non-elaborative response?
  sycophancyDetected: boolean     // did monitoring flag the response?
  sessionContinued: boolean       // did the user send another message?
  // Delayed outcome
  userReturnedWithinDays: number | null  // populated after session end
}
```

This log feeds:
- The contextual bandit (policy selection learning)
- Quality monitoring (Langfuse integration, LLM-as-judge on sample)
- Observability (the /observe mode equivalent)
- Research (the data asset for understanding human-AI interaction)

### Interface: SteeringResult

```
SteeringResult {
  systemPrompt: string
  reformulatedMessage: string
  modelConfig: {
    tier: ambient | standard | deep
    model: string
    temperature: float
    maxTokens: number
  }
  responseDirective: ResponseDirective  // for logging and observability
  selectedPolicy: PolicyReference       // for logging
  recallTriggered: boolean              // did deep recall fire?
  postResponseActions: {
    classifyProfile: boolean
    extractMemories: boolean
    logTurn: boolean
  }
}
```

The Intermediary exposes a single function: `steer(userMessage, personContext, productIdentity, sessionHistory) → SteeringResult`.

### Model Tier Routing

Derived from the ResponseDirective:

| Signal | Tier | Model |
|--------|------|-------|
| communicativeIntent = distress | deep | Opus |
| communicativeIntent = connecting | ambient | Haiku |
| communicativeIntent = requesting_input + high arousal | deep | Opus |
| communicativeIntent = sense_making + established relationship | deep | Opus |
| Classifier confidence < 0.3 | standard | Sonnet |
| Everything else | standard | Sonnet |

---

## Layer C: Product Shell — Jasper

### Purpose

The user-facing product. Consumes Backbone and Intermediary, adds identity, voice, activities, and interface.

### C1. Identity

Jasper's character definition, provided as a `ProductIdentity` to the Intermediary:

```
ProductIdentity {
  name: "Jasper"
  identityPrompt: "Your name is Jasper..." // character, personality, identity rules
  obligations: "YOUR OBLIGATIONS: ..." // product-specific behavioural requirements
  antiLabellingRule: "ANTI-LABELLING RULE: ..." // product-specific conversational rules
}
```

To build a different product (strategy consultant, executive coach, study partner), create a different ProductIdentity. Everything in Backbone and Intermediary works unchanged.

### C2. Voice

- **TTS**: OpenAI tts-1, voice "onyx" (validated as most natural for conversational companion use)
- **STT**: OpenAI Whisper ($0.006/min)
- **Back-channelling**: Architecture slot for producing continuers during user speech (v2 enhancement — requires separate pipeline from response generation)
- **Prosodic control**: Architecture slot for emotional matching in voice output (v2 enhancement — dependent on TTS provider capabilities)

Voice is text-first with audio overlay. Text always displays. Audio plays after text streaming completes (wait-then-speak for v2 CLI/web; chunked streaming for future real-time voice mode).

### C3. Activities

Games and companion activities bypass the Intermediary entirely — no classification, no policy selection, no reformulation. Direct LLM call with activity-specific prompts.

Activities: 20 Questions, Rapid Fire, Would You Rather, Trivia, Collaborative Story, General Play. No expansion until data shows which ones drive engagement.

### C4. Interface

**v2 launch**: Minimal web chat UI (iMessage-style). Deploy on Vercel. Supabase Auth for multi-user support.

**CLI**: Retained for development. /observe shows the full decision chain: ResponseDirective, selected policy, assembled prompt, reformulated message, validation layer interventions, bandit exploration flag.

---

## Multi-Scale State Model

State is tracked at three timescales. The Classifier sees all three.

### Turn-Level (updated every turn)

- Communicative intent
- Emotional valence and arousal
- Conversational phase
- Detected entities / topics
- Whether this turn references a past conversation

Owned by: Intermediary (computed per-turn, not persisted beyond session)

### Session-Level (built over a session)

- Topic stack with depth (what we've discussed, in what order, how deep)
- Emotional arc trajectory (how the emotional state has moved across the session)
- Challenge readiness per topic (may differ from turn-level — readiness builds over a conversation)
- Reflection-to-question ratio (running count)
- Turns since last anti-sycophancy re-injection

Owned by: Intermediary (persisted in session state, discarded at session end except for summary)

### Relationship-Level (persists across sessions)

- Relational depth (derived from conversation count, disclosure patterns, challenge acceptance history)
- Trust level (proxy: does the user accept or deflect challenges?)
- Communication style preferences (learned from interaction patterns)
- Growth trajectory (which patterns are shifting across sessions)
- Last session emotional ending (for cross-session continuity — relational, not emotional)

Owned by: Backbone (persisted in profile and conversation metadata)

---

## Data Model

### Supabase Tables

**user_profiles** — the structured psychological model
- id, user_id, created_at, updated_at
- identity, values, patterns, relationships, current_state, interaction_prefs (all JSONB)
- relationship_meta (JSONB: conversation_count, first_conversation, total_messages)

**conversations** — full conversation history
- id, user_id, created_at, ended_at
- messages (JSONB array — full message history, never truncated)
- summary (TEXT — 2-3 sentence briefing)
- classification (JSONB — post-conversation analysis)
- ending_state (JSONB — emotional valence, topic, for cross-session continuity)

**conversation_segments** — embedded segments for deep recall (Q8 architecture TBD)
- id, conversation_id, user_id
- segment_text (TEXT — the actual exchange)
- segment_embedding (vector — for semantic search)
- segment_type (enum: disclosure, insight, challenge, turning_point, routine)
- turn_range (int range — which turns in the parent conversation)

**turn_logs** — the feedback loop data
- id, user_id, conversation_id, turn_number, timestamp
- user_message, response_directive (JSONB), selected_policy_id
- assistant_response, model_config (JSONB)
- exploration_flag (boolean)
- engagement_depth (float, populated async)
- challenge_accepted (boolean, populated async)
- low_energy (boolean, populated async)
- sycophancy_detected (boolean, populated async)
- session_continued (boolean, populated async)

**policy_library** — behavioural policies (could also be file-based)
- id, name, posture_class, relational_depth_range
- system_prompt_fragment (TEXT)
- response_structure (JSONB)
- constraints (JSONB)
- version, active (boolean)

**bandit_state** — per-user policy learning state
- user_id, policy_id, context_features (JSONB)
- alpha, beta (Thompson Sampling parameters)
- updated_at

**memories + memory_history** — Mem0 tables (existing)

---

## Economics (300 Users, Moderate Engagement)

| Component | Rate | Monthly |
|-----------|------|---------|
| LLM — conversation (Anthropic, mixed tiers) | — | ~$168 |
| LLM — classification (Haiku, every turn) | — | ~$25 |
| TTS (OpenAI, responses) | $15/1M chars | ~$40 |
| STT (OpenAI Whisper, user speech) | $0.006/min | ~$270 |
| Mem0 extraction (GPT-4o-mini) | — | ~$15 |
| Quality eval (Haiku, 10-20% sample) | — | ~$8 |
| Supabase Pro | — | $25 |
| Vercel Pro | — | $20 |
| **Total** | | **~$571/month** |
| **Per user** | | **~$1.90/month** |

Text-only (no voice): ~$261/month, ~$0.87/user.

Classification adds ~$25/month for 300 users — trivial. The bandit learning has near-zero marginal cost (Thompson Sampling is a lightweight computation, not an LLM call).

---

## What We Build First

### Phase 1: Core Engine (Weeks 1-3)

Build the three layers with clean interfaces, single-pass classification, policy library, and prompt assembly. No bandit learning yet — use a deterministic policy selector (best-match from library based on classifier output). This gives us the correct architecture without the complexity of the learning loop.

1. Backbone: profile CRUD, Mem0 integration (with temporal gating), conversation store, PersonContext assembly
2. Intermediary: single-pass classifier, policy library (15-20 policies as YAML/JSON), deterministic selector, Priompt-style prompt assembler, reformulator, validation layer, anti-sycophancy defence
3. Product: Jasper identity, web chat UI, Supabase Auth, voice (TTS + STT)
4. Orchestration: thin chat route composing all three layers
5. Observability: turn logging, /observe mode, Langfuse integration

### Phase 2: Learning Loop (Weeks 4-6)

Add the contextual bandit. This requires turn logs from Phase 1 to have accumulated enough data.

1. Thompson Sampling bandit with population-level priors
2. Outcome signals: engagement depth, challenge acceptance, low-energy detection, sycophancy monitoring
3. Returnability tracking (delayed signal — user returns within 1-3 days)
4. Cold-start protocol: balanced default policy for first 20 interactions, then active exploration
5. Bandit dashboard: which policies are winning for which contexts and users

### Phase 3: Deep Recall (Weeks 6-8, Pending Q8 Research)

Add the conversation archive search and hierarchical retrieval system.

1. Segment embedding pipeline (process existing conversation history)
2. Reference detection in classifier (trigger deep recall when user references past conversations)
3. Hierarchical retrieval: summary → topic → exchange
4. Integration into PersonContext and prompt assembly

### Phase 4: Refinement (Ongoing)

1. Interaction archetype detection (do users cluster into types?)
2. Voice back-channelling
3. Prosodic emotional matching
4. Policy library expansion based on data
5. Cross-session relational continuity refinement

---

## What We Don't Build

- **State machine for conversation flow** — the classifier handles phase detection, XState adds complexity without value for open-domain conversation
- **Custom voice selection** — hardcode Onyx, revisit when data shows voice matters for returnability
- **Voice cloning** — uncanny valley risk, deferred indefinitely
- **Fine-tuned models** — use off-the-shelf Claude/OpenAI via API. Fine-tuning is a scale optimisation, not a product decision
- **More activities** — the existing six are sufficient until data says otherwise
- **Explicit user feedback mechanisms** — no thumbs up/down, no ratings. The system learns from behaviour, not stated preferences. Stated preferences are how you build a sycophant.
