export type L10nStage =
  | 'idle'
  | 'input'
  | 'figma-scanning'
  | 'table-creating'
  | 'english-review'
  | 'id-generating'
  | 'wiki-review'
  | 'json-applying'
  | 'complete'
  | 'error';

export type ReleaseDateSource = 'auto' | 'manual';

export interface L10nInput {
  wikiUrl: string;
  figmaUrls: string[];
  releaseDate: string;
  releaseDateSource: ReleaseDateSource;
}

export type L10nIssueCode =
  | 'WIKI_ROW_MISSING'
  | 'FIGMA_TAG_MISSING'
  | 'KOREAN_MISMATCH'
  | 'FIGMA_TAG_INVALID'
  | 'FIGMA_TARGET_MISSING'
  | 'ENGLISH_MISSING'
  | 'STRING_ID_INVALID'
  | 'TARGET_FILE_MISSING'
  | 'LLM_INFERENCE_FAILED';

export interface L10nIssue {
  code: L10nIssueCode;
  message: string;
  rowKey?: string;
  delimiter?: string;
  frameName?: string;
}

export interface L10nStats {
  total: number;
  matched: number;
  reused: number;
  created: number;
  common: number;
  renumbered: number;
  skipped: number;
}

export interface L10nTaskState {
  stage: L10nStage;
  label: string;
  attentionCount: number;
  issues: L10nIssue[];
  stats: L10nStats;
  lastGeneratedAt?: string;
  error?: string;
  canGenerate: boolean;
  canFinalize: boolean;
  canCancel: boolean;
}

export interface L10nConfigStatus {
  configured: boolean;
  envPath: string;
  missing: string[];
}

export interface ReleaseDateSuggestion {
  releaseDate: string;
  version?: string;
  source: 'wiki' | 'figma' | 'manual';
  warning?: string;
}

export interface L10nRunResult {
  state: L10nTaskState;
  pageUrl?: string;
  diff?: string;
}

export interface InputStringEntry {
  Text: string;
  ReleaseDate: string;
}

export type InputFileData = Record<string, InputStringEntry>;
