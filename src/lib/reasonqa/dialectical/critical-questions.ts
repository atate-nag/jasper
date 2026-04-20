// Walton-based critical questions for argumentation schemes.

import type { ArgumentationScheme, CriticalQuestion } from '../types';

export const CRITICAL_QUESTIONS: Record<ArgumentationScheme, CriticalQuestion[]> = {
  argument_from_authority: [
    { id: 'auth_1', text: 'Is the cited authority credible and in good standing?', attackType: 'undermining' },
    { id: 'auth_2', text: 'Is the authority an expert in the relevant field/jurisdiction?', attackType: 'undermining' },
    { id: 'auth_3', text: 'What exactly did the authority hold or state?', attackType: 'undermining' },
    { id: 'auth_4', text: 'Is the authority consistent with other authorities on this point?', attackType: 'rebutting' },
    { id: 'auth_5', text: 'Is the authority based on evidence relevant to this case?', attackType: 'undercutting' },
    { id: 'auth_6', text: 'Has the authority been distinguished, overruled, or limited?', attackType: 'undercutting' },
  ],
  argument_from_analogy: [
    { id: 'ana_1', text: 'Are the two cases genuinely similar in relevant respects?', attackType: 'undercutting' },
    { id: 'ana_2', text: 'Is the base case accurately described?', attackType: 'undermining' },
    { id: 'ana_3', text: 'Do counter-analogies exist that support the opposite conclusion?', attackType: 'rebutting' },
  ],
  argument_from_rules: [
    { id: 'rul_1', text: 'Is the rule correctly stated?', attackType: 'undermining' },
    { id: 'rul_2', text: 'Does the rule apply to these facts?', attackType: 'undercutting' },
    { id: 'rul_3', text: 'Is there an exception that applies?', attackType: 'undercutting' },
    { id: 'rul_4', text: 'Does a conflicting rule of higher authority apply?', attackType: 'rebutting' },
  ],
  argument_from_evidence: [
    { id: 'evi_1', text: 'Is the evidence reliable and accurately reported?', attackType: 'undermining' },
    { id: 'evi_2', text: 'Does the evidence actually support the inference drawn?', attackType: 'undercutting' },
    { id: 'evi_3', text: 'Is there counter-evidence that supports an opposite conclusion?', attackType: 'rebutting' },
  ],
  argument_from_sign: [
    { id: 'sig_1', text: 'Is the indicator reliable for what it purportedly signifies?', attackType: 'undercutting' },
    { id: 'sig_2', text: 'Are there alternative explanations for the observed sign?', attackType: 'rebutting' },
  ],
  practical_reasoning: [
    { id: 'pra_1', text: 'Are there conflicting goals that this action undermines?', attackType: 'rebutting' },
    { id: 'pra_2', text: 'Are there alternative actions that achieve the goal more effectively?', attackType: 'rebutting' },
    { id: 'pra_3', text: 'Is the proposed action actually feasible?', attackType: 'undermining' },
    { id: 'pra_4', text: 'Are there negative side effects that outweigh the benefits?', attackType: 'rebutting' },
  ],
  argument_from_classification: [
    { id: 'cla_1', text: 'Is the classification correct — do the facts fit the legal category?', attackType: 'undermining' },
    { id: 'cla_2', text: 'Are there borderline features that make classification uncertain?', attackType: 'undercutting' },
    { id: 'cla_3', text: 'Does a different classification apply that leads to a different conclusion?', attackType: 'rebutting' },
  ],
  argument_from_precedent: [
    { id: 'pre_1', text: 'Is the precedent binding or merely persuasive?', attackType: 'undercutting' },
    { id: 'pre_2', text: 'Is the precedent factually distinguishable?', attackType: 'undercutting' },
    { id: 'pre_3', text: 'Has the precedent been overruled or doubted?', attackType: 'rebutting' },
  ],
  causal_argument: [
    { id: 'cau_1', text: 'Is there actually a causal connection, or merely correlation?', attackType: 'undercutting' },
    { id: 'cau_2', text: 'Are there intervening causes that break the causal chain?', attackType: 'undercutting' },
    { id: 'cau_3', text: 'Is the causal claim based on sufficient evidence?', attackType: 'undermining' },
  ],
  argument_from_negative_consequences: [
    { id: 'neg_1', text: 'Will the negative consequences actually occur?', attackType: 'undermining' },
    { id: 'neg_2', text: 'Are the consequences as severe as claimed?', attackType: 'undermining' },
    { id: 'neg_3', text: 'Do the positive consequences outweigh the negative?', attackType: 'rebutting' },
  ],
  argument_from_position_to_know: [
    { id: 'ptk_1', text: 'Is the source actually in a position to know?', attackType: 'undermining' },
    { id: 'ptk_2', text: 'Is the source trustworthy and unbiased?', attackType: 'undermining' },
  ],
  argument_from_correlation: [
    { id: 'cor_1', text: 'Is the correlation statistically significant?', attackType: 'undermining' },
    { id: 'cor_2', text: 'Are there confounding variables?', attackType: 'undercutting' },
  ],
  argument_from_best_explanation: [
    { id: 'abe_1', text: 'Is there a better explanation for the observed data?', attackType: 'rebutting' },
    { id: 'abe_2', text: 'Does the explanation actually account for all the evidence?', attackType: 'undermining' },
  ],
  other: [],
};
