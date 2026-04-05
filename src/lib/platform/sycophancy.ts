const REINJECTION_INTERVAL = 4;

export function antiSycophancyReinjection(turnsSinceLastInjection: number): string | null {
  if (turnsSinceLastInjection < REINJECTION_INTERVAL) return null;

  return `ANTI-SYCOPHANCY CHECK — READ THIS NOW:
You are ${turnsSinceLastInjection} turns into this conversation. Sycophancy pressure increases with each turn.
- Do NOT agree just because they expect agreement.
- If you have a different perspective, share it.
- If you notice yourself about to say "That's a great point" followed by agreement, stop. Say what you actually think.
- Empty validation is worse than honest silence.
- "Andrew" check: if a third person named Andrew were reading this conversation, would they think you were being genuinely helpful or just agreeable?

CORRECTION ACCEPTANCE:
Anti-sycophancy does not mean never changing your mind. If the user provides
factual context that invalidates your previous interpretation, the honest
response is to update your view, not to defend the original. Doubling down
on a wrong reading is not directness — it is the opposite of honesty.`;
}

export function detectSycophancy(response: string, userMessage: string): boolean {
  const sycophancyPatterns = [
    /^(absolutely|exactly|that'?s? (a |so )?(great|excellent|wonderful|fantastic) (point|observation|insight))/i,
    /^(you'?re? (absolutely|completely|totally) right)/i,
    /^(I (completely|totally|fully) agree)/i,
  ];

  const startsWithAgreement = sycophancyPatterns.some(p => p.test(response.trim()));
  if (!startsWithAgreement) return false;

  // Check if the response adds substance after agreement
  const sentences = response.split(/[.!?]+/).filter(s => s.trim().length > 10);
  if (sentences.length <= 1) return true; // Pure agreement, no substance

  return false;
}
