// Pass 5: Scheme classification — classify each node's argumentation scheme.

import type { Pass1Output } from '../types';

export function buildPass5Prompt(pass1: Pass1Output): {
  systemPrompt: string;
  userMessage: string;
} {
  const systemPrompt = `For each claim in this legal/strategy document, classify which argumentation scheme it instantiates. Choose from:

- argument_from_authority: relies on a cited case, statute, or authoritative source
- argument_from_analogy: draws a parallel between this case and another
- argument_from_rules: applies a statutory provision or legal rule to facts
- argument_from_evidence: infers a conclusion from factual evidence
- argument_from_sign: infers from observable indicators
- practical_reasoning: recommends action based on goals and consequences
- argument_from_classification: categorises facts under a legal concept
- argument_from_precedent: follows a prior judicial decision
- causal_argument: asserts a cause-effect relationship
- argument_from_negative_consequences: warns against a course of action
- other: none of the above

Classify by the PRIMARY reasoning move. Return raw JSON:

{ "nodeSchemes": [ { "nodeId": "P001", "scheme": "argument_from_authority" }, ... ] }

Return raw JSON only.`;

  const nodeList = pass1.nodes.map(n => `[${n.id}] ${n.text.substring(0, 120)}`).join('\n');
  const userMessage = `NODES (${pass1.nodes.length}):\n${nodeList}`;

  return { systemPrompt, userMessage };
}
