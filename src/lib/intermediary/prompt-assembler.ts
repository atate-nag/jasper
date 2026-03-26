interface PromptComponent {
  priority: number;
  content: string;
  label: string;
  tokenEstimate: number;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).length * 1.3);
}

export function assemblePrompt(
  components: PromptComponent[],
  maxTokens: number = 8000,
): { prompt: string; includedComponents: string[]; excludedComponents: string[] } {
  // Sort by priority descending
  const sorted = [...components].sort((a, b) => b.priority - a.priority);

  const included: PromptComponent[] = [];
  const excluded: string[] = [];
  let tokenCount = 0;

  for (const component of sorted) {
    if (tokenCount + component.tokenEstimate <= maxTokens) {
      included.push(component);
      tokenCount += component.tokenEstimate;
    } else {
      excluded.push(component.label);
    }
  }

  // Order in final prompt: identity/obligations at start, policy directives at end
  // (Lost in the Middle mitigation)
  const highPriority = included.filter(c => c.priority >= 90);
  const midPriority = included.filter(c => c.priority >= 40 && c.priority < 90);
  const lowPriority = included.filter(c => c.priority < 40);
  const policyDirectives = included.filter(c => c.label === 'policy_directive');

  // Remove policy directives from their natural position and place at end
  const reordered = [
    ...highPriority.filter(c => c.label !== 'policy_directive'),
    ...midPriority.filter(c => c.label !== 'policy_directive'),
    ...lowPriority.filter(c => c.label !== 'policy_directive'),
    ...policyDirectives,
  ];

  // Log component sizes
  console.log(`[prompt] Components included: ${included.length}, excluded: ${excluded.length}, total ~${tokenCount} tokens`);
  for (const c of reordered) {
    console.log(`[prompt]   ${c.label}: ~${c.tokenEstimate} tokens (priority ${c.priority})`);
  }

  return {
    prompt: reordered.map(c => c.content).join('\n\n'),
    includedComponents: reordered.map(c => c.label),
    excludedComponents: excluded,
  };
}

export { type PromptComponent };
