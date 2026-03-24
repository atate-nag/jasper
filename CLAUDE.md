# Jasper — Project Conventions

## Architecture
- Three layers: backbone (person model), intermediary (steering engine), product (Jasper)
- Dependency: product → intermediary → backbone. Never reverse.
- Architecture doc: /docs/architecture-v2.md — read before making structural decisions

## Key Principles
- ONE decision, not a cascade. The classifier produces a complete ResponseDirective.
  No downstream stage modifies or overrides the classification.
- Policy as data, not code. Behavioural policies are YAML files in /docs/policies/.
  Change behaviour by changing policy files, not application code.
- Warmth-first under uncertainty. When classifier confidence < 0.5, default to
  warm-reflective posture class. Presence over analysis.

## Code Style
- TypeScript strict mode
- Explicit return types on all exported functions
- No any types — use unknown and narrow
- Prefer named exports over default exports
- One concern per file — if a file exceeds 200 lines, it probably does too much

## Layer Rules
- backbone/: NEVER imports from intermediary/ or product/
- intermediary/: NEVER imports from product/
- product/: Can import from both
- llm/: Shared utility, no layer-specific logic

## Testing
- Integration tests for each layer's public API
- The platform test: can you call steer() with a mock PersonContext
  and a different ProductIdentity? If not, the separation is broken.

## Database
- Supabase with RLS policies scoped to authenticated user
- All profile/conversation/memory data is user-scoped
- Turn logs include full steering metadata for the feedback loop

## Policies
- YAML files in /docs/policies/
- Each policy is self-contained — no inheritance, no modifiers
- Policy selection is deterministic in Phase 1 (best match from classifier output)
- Phase 2 adds contextual bandit — the logging infrastructure must be ready from day 1
