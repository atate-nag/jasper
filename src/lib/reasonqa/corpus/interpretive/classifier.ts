// Classify how a citing case treats an authority using Haiku.

import { callModelZDR } from '../../model-client';
import { logUsage } from '@/lib/usage';
import { REASONQA_HAIKU } from '../../models';
import type { TreatmentType, CitationWindow, ClassifiedCitation } from './types';

const VALID_TREATMENTS: TreatmentType[] = ['SUPPORTS', 'UNDERMINES', 'DISTINGUISHES', 'NEUTRAL', 'IRRELEVANT'];

export async function classifyCitationTreatment(
  window: CitationWindow,
  authorityName: string,
  proposition: string,
  userId?: string,
): Promise<ClassifiedCitation> {
  const systemPrompt = `You are analysing how a court applied a legal authority. Answer with exactly one treatment type followed by a 2-3 sentence explanation.

Treatment types:
- SUPPORTS: The citing case applies the authority consistently with the proposition
- UNDERMINES: The citing case applies the authority in a way that contradicts or limits the proposition
- DISTINGUISHES: The citing case acknowledges the authority but finds it inapplicable on different facts
- NEUTRAL: The citing case mentions the authority without clearly supporting or undermining the proposition
- IRRELEVANT: The mention is not substantively related to the proposition

Format: Start your response with the treatment type in capitals on its own line, then the explanation.`;

  const userMessage = `AUTHORITY: ${authorityName}

PROPOSITION IT IS CITED FOR IN THE DOCUMENT UNDER ANALYSIS:
${proposition}

CITING CASE: ${window.citingCase}

PARAGRAPHS FROM THE CITING CASE WHERE THE AUTHORITY IS DISCUSSED:
${window.paragraphs}

How does this citing case treat the authority in relation to the proposition?`;

  try {
    const result = await callModelZDR(
      REASONQA_HAIKU,
      systemPrompt,
      [{ role: 'user', content: userMessage }],
      0.1,
    );
    if (userId) logUsage(result.usage, 'reasonqa:interpretive', userId);

    const text = result.text.trim();
    const firstLine = text.split('\n')[0].trim().toUpperCase();
    const treatment = VALID_TREATMENTS.find(t => firstLine.startsWith(t)) || 'NEUTRAL';
    const explanation = text.split('\n').slice(1).join(' ').trim() || text;
    console.log(`[interpretive]   Classify: ${window.citingCaseUri} → ${treatment}: ${explanation.substring(0, 120)}`);

    return {
      citingCase: window.citingCase,
      citingCaseUri: window.citingCaseUri,
      treatment,
      explanation,
      paragraphs: window.paragraphs,
    };
  } catch (err) {
    console.log(`[interpretive]   Classify: ${window.citingCaseUri} FAILED (${err instanceof Error ? err.message : err})`);
    return {
      citingCase: window.citingCase,
      citingCaseUri: window.citingCaseUri,
      treatment: 'NEUTRAL',
      explanation: 'Classification failed',
      paragraphs: window.paragraphs,
    };
  }
}
