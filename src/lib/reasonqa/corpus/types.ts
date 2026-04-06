export interface ParsedCitation {
  raw: string;
  type: 'case' | 'statute' | 'unknown';
  // Case-specific
  ncn?: string;
  caseName?: string;
  court?: string;
  year?: number;
  number?: number;
  uri?: string;
  // Statute-specific
  actName?: string;
  actType?: string;
  actYear?: number;
  actChapter?: number;
  section?: string;
  legislationUri?: string;
  // Common
  paragraph?: string;
}

export interface FetchedSource {
  citation: ParsedCitation;
  found: boolean;
  text?: string;
  paragraphs?: Record<string, string>;
  url: string;
  fetchedAt: Date;
}
