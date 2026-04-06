// Document text extraction — PDF, DOCX, PPTX, TXT, MD.

const MAX_CHARS = 200_000;

export async function parseDocument(
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  let text: string;

  if (mimeType === 'application/pdf') {
    const { extractText } = await import('unpdf');
    const result = await extractText(new Uint8Array(buffer), { mergePages: true });
    text = result.text;
  } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else if (mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
    text = parsePptx(buffer);
  } else if (mimeType === 'text/plain' || mimeType === 'text/markdown') {
    text = buffer.toString('utf-8');
  } else {
    throw new Error(`Unsupported file type: ${mimeType}`);
  }

  text = text.trim();
  if (!text) throw new Error('Document is empty after text extraction');

  return text;
}

/** Extract text from PPTX by reading slide XML from the zip. */
function parsePptx(buffer: Buffer): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  // Slides are at ppt/slides/slide1.xml, slide2.xml, etc.
  const slideEntries = entries
    .filter((e: { entryName: string }) => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a: { entryName: string }, b: { entryName: string }) => {
      const numA = parseInt(a.entryName.match(/slide(\d+)/)?.[1] || '0');
      const numB = parseInt(b.entryName.match(/slide(\d+)/)?.[1] || '0');
      return numA - numB;
    });

  const slideTexts: string[] = [];
  for (const entry of slideEntries) {
    const xml = entry.getData().toString('utf-8');
    // Extract text from <a:t> tags (PowerPoint text runs)
    const texts: string[] = [];
    const regex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      const t = match[1].trim();
      if (t) texts.push(t);
    }
    if (texts.length > 0) {
      slideTexts.push(texts.join(' '));
    }
  }

  return slideTexts.join('\n\n');
}

export function validateDocument(text: string): { valid: boolean; error?: string } {
  if (text.length < 100) {
    return { valid: false, error: 'Document is too short for meaningful analysis (minimum ~100 characters).' };
  }
  if (text.length > MAX_CHARS) {
    return { valid: false, error: `Document is too long (${Math.round(text.length / 1000)}k chars). Maximum is ${MAX_CHARS / 1000}k characters.` };
  }
  return { valid: true };
}
