export type TreatmentType = 'SUPPORTS' | 'UNDERMINES' | 'DISTINGUISHES' | 'NEUTRAL' | 'IRRELEVANT';

export interface AuthorityRef {
  name: string;
  citation?: string;
  proposition: string;
  nodeIds: string[];
  searchQuery: string;
}

export interface SearchHit {
  title: string;
  uri: string;
  date: string;
}

export interface CitationWindow {
  citingCase: string;
  citingCaseUri: string;
  paragraphs: string;
}

export interface ClassifiedCitation {
  citingCase: string;
  citingCaseUri: string;
  treatment: TreatmentType;
  explanation: string;
  paragraphs: string;
  date?: string;         // from Atom feed <published>
  inDocument?: boolean;  // whether the citing case appears in the source document
}

export interface InterpretiveFlags {
  janusFaced: boolean;
  eroded: boolean;
  overreliedContested: boolean;
  uncitedCounterAuthorities: string[];  // case names not found in document
  stale: boolean;
}

export interface AuthorityContext {
  authority: AuthorityRef;
  supports: ClassifiedCitation[];
  undermines: ClassifiedCitation[];
  distinguishes: ClassifiedCitation[];
  janusFaced: boolean;
  flags: InterpretiveFlags;
}

export interface InterpretiveContext {
  authorities: AuthorityContext[];
  janusFacedCount: number;
  totalCitingCases: number;
  totalClassifications: number;
}
