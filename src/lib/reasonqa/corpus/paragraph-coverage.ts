// Deterministic paragraph coverage assessment for retrieved source text.
// Prevents hallucinated verifications of paragraphs not in the retrieved text.

export interface ParagraphCoverage {
  maxParagraph: number;
  paragraphsFound: number[];
  isTruncated: boolean;
  coverageGaps: [number, number][];
}

export function assessParagraphCoverage(retrievedText: string): ParagraphCoverage {
  const paraPattern = /(?:^|\n)\s*(?:\[)?(\d+)(?:\])?\.\s/g;
  const found: number[] = [];
  let match;

  while ((match = paraPattern.exec(retrievedText)) !== null) {
    const n = parseInt(match[1]);
    if (n > 0 && n < 1000) found.push(n); // sanity bound
  }

  // Also check for [N] style (common in some judgments)
  const bracketPattern = /\[(\d+)\]/g;
  while ((match = bracketPattern.exec(retrievedText)) !== null) {
    const n = parseInt(match[1]);
    if (n > 0 && n < 1000 && !found.includes(n)) found.push(n);
  }

  found.sort((a, b) => a - b);
  const unique = [...new Set(found)];

  const max = unique.length > 0 ? unique[unique.length - 1] : 0;

  const lastChars = retrievedText.trim().slice(-200);
  const isTruncated = !lastChars.match(/\.\s*$/) ||
    lastChars.includes('...') ||
    (unique.length > 0 && unique.length < max * 0.5); // many gaps suggests truncation

  const gaps: [number, number][] = [];
  for (let i = 1; i < unique.length; i++) {
    if (unique[i] - unique[i - 1] > 1) {
      gaps.push([unique[i - 1] + 1, unique[i] - 1]);
    }
  }

  return { maxParagraph: max, paragraphsFound: unique, isTruncated, coverageGaps: gaps };
}

export function extractParagraphReferences(text: string): number[] {
  const refs: number[] = [];
  let match;

  // "paragraph 69" / "para 69" / "para. 69"
  const paraPattern = /(?:paragraph|para\.?)\s+(\d+)/gi;
  while ((match = paraPattern.exec(text)) !== null) refs.push(parseInt(match[1]));

  // "at [69]" / "[69]" / "§69"
  const bracketPattern = /(?:at\s+)?\[(\d+)\]|§\s*(\d+)/g;
  while ((match = bracketPattern.exec(text)) !== null) refs.push(parseInt(match[1] || match[2]));

  // "paras 72-73"
  const rangePattern = /(?:paragraphs?|paras?\.?)\s+(\d+)\s*[-–]\s*(\d+)/gi;
  while ((match = rangePattern.exec(text)) !== null) {
    for (let i = parseInt(match[1]); i <= parseInt(match[2]); i++) refs.push(i);
  }

  return [...new Set(refs)];
}

export function checkParagraphAvailability(
  claimText: string,
  coverage: ParagraphCoverage,
): 'available' | 'unavailable' | 'uncertain' {
  const refs = extractParagraphReferences(claimText);
  if (refs.length === 0) return 'uncertain';

  for (const ref of refs) {
    if (ref > coverage.maxParagraph) return 'unavailable';
    if (!coverage.paragraphsFound.includes(ref)) return 'unavailable';
  }
  return 'available';
}

export function generateSourceQualification(
  coverage: ParagraphCoverage,
  claimTexts: string[],
): string | null {
  const allRefs = claimTexts.flatMap(t => extractParagraphReferences(t));
  const maxRef = allRefs.length > 0 ? Math.max(...allRefs) : 0;

  if (maxRef > coverage.maxParagraph && coverage.maxParagraph > 0) {
    const unreachable = [...new Set(allRefs.filter(r => r > coverage.maxParagraph))];
    return `SOURCE LIMITATION: Retrieved judgment covers paragraphs 1-${coverage.maxParagraph}, ` +
      `but the document references paragraphs up to ${maxRef}. ${unreachable.length} citation(s) ` +
      `referencing paragraphs ${unreachable.join(', ')} cannot be verified and are marked UNTRACEABLE.`;
  }

  if (coverage.isTruncated && coverage.maxParagraph > 0) {
    return `SOURCE LIMITATION: Retrieved judgment appears truncated (ends at paragraph ${coverage.maxParagraph}). ` +
      `Citations referencing later paragraphs cannot be verified.`;
  }

  return null;
}
