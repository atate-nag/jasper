// Extract readable text from LegalDocML (case law) and CLML (legislation) XML.
// Uses regex-based extraction — no XML parser dependency needed.

/**
 * Extract text from LegalDocML (National Archives case law).
 * Structure: <akomaNtoso><judgment><judgmentBody><decision><paragraph>...
 */
export function extractTextFromLegalDocML(xml: string): string {
  const paragraphs = extractParagraphsFromLegalDocML(xml);
  const keys = Object.keys(paragraphs).sort((a, b) => parseInt(a) - parseInt(b));
  return keys.map(k => `[${k}] ${paragraphs[k]}`).join('\n\n');
}

/**
 * Extract paragraph map from LegalDocML: paragraph number → text.
 */
export function extractParagraphsFromLegalDocML(xml: string): Record<string, string> {
  const paragraphs: Record<string, string> = {};

  // Match <paragraph> elements with eId or num
  const paraRegex = /<paragraph[^>]*>[\s\S]*?<\/paragraph>/gi;
  let match;

  while ((match = paraRegex.exec(xml)) !== null) {
    const block = match[0];

    // Extract paragraph number from <num> tag
    const numMatch = block.match(/<num[^>]*>([\s\S]*?)<\/num>/i);
    let num = numMatch ? stripTags(numMatch[1]).trim().replace(/\.$/, '') : null;

    // Fallback: extract from eId attribute
    if (!num) {
      const eidMatch = block.match(/eId="para[_-]?(\d+)"/i);
      num = eidMatch ? eidMatch[1] : null;
    }

    if (!num) continue;

    // Extract text content — strip all XML tags
    const text = stripTags(block)
      .replace(/\s+/g, ' ')
      .trim();

    if (text) {
      paragraphs[num] = text;
    }
  }

  // If no <paragraph> elements found, try <p> elements directly
  if (Object.keys(paragraphs).length === 0) {
    const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let pIdx = 1;
    while ((match = pRegex.exec(xml)) !== null) {
      const text = stripTags(match[1]).replace(/\s+/g, ' ').trim();
      if (text.length > 20) {
        paragraphs[String(pIdx)] = text;
        pIdx++;
      }
    }
  }

  return paragraphs;
}

/**
 * Extract text from CLML (Crown Legislation Markup Language).
 * Used for legislation.gov.uk content.
 */
export function extractTextFromCLML(xml: string): string {
  // Try structured extraction first: <P1>, <P2>, <P1para> elements
  const parts: string[] = [];

  // Extract <Text> elements (common in CLML)
  const textRegex = /<Text[^>]*>([\s\S]*?)<\/Text>/gi;
  let match;
  while ((match = textRegex.exec(xml)) !== null) {
    const text = stripTags(match[1]).replace(/\s+/g, ' ').trim();
    if (text) parts.push(text);
  }

  if (parts.length > 0) return parts.join('\n\n');

  // Fallback: extract all <P> / <p> content
  const pRegex = /<[Pp][^>]*>([\s\S]*?)<\/[Pp]>/gi;
  while ((match = pRegex.exec(xml)) !== null) {
    const text = stripTags(match[1]).replace(/\s+/g, ' ').trim();
    if (text.length > 10) parts.push(text);
  }

  if (parts.length > 0) return parts.join('\n\n');

  // Last resort: strip all tags
  return stripTags(xml).replace(/\s+/g, ' ').trim();
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}
