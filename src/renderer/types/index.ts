export interface SearchResult {
  id: string;
  value: string;
  filename: string;
  matchType?: 'direct' | 'synonym';
  synonymSource?: string;
  isInputFolder?: boolean;
  priority?: number;
}

export interface SynonymSearchResult {
  results: SearchResult[];
  synonymsList: string[];
}

export interface AnalyticsData {
  userId: string;
  firstInstalled: string;
  appVersion: string;
  totalSearches: number;
  totalGitPulls: number;
  languageUsage: Record<string, number>;
  features: {
    synonymsViews: number;
    translationsViews: number;
    predictedTranslationsViews: number;
    predictedTranslationsFailed: number;
    abbreviatedTranslationsViews: number;
    abbreviatedTranslationsFailed: number;
    guideButtonClicks: number;
    patchNotesButtonClicks: number;
  };
}

export interface PredictedTranslation {
  language: string;
  value: string;
}

export interface ElectronAPI {
  searchStrings: (query: string, language: string) => Promise<SearchResult[]>;
  getLanguages: () => Promise<string[]>;
  getFolderPath: () => Promise<string | null>;
  validateFolderPath: (path: string) => Promise<boolean>;
  setFolderPath: (path: string) => Promise<boolean>;
  browseFolderPath: () => Promise<string | null>;
  gitPull: () => Promise<boolean>;
  getLastUpdateTime: () => Promise<string>;
  copyToClipboard: (text: string) => Promise<boolean>;
  saveSearchHistory: (query: string) => Promise<boolean>;
  getSearchHistory: () => Promise<string[]>;
  searchTranslations: (stringId: string) => Promise<SearchResult[]>;
  searchSynonyms: (searchQuery: string, targetLanguage: string) => Promise<SynonymSearchResult>;
  getPredictedTranslations: (query: string) => Promise<PredictedTranslation[]>;
  getAbbreviatedTranslations: (originalEnglish: string, formalTranslations: PredictedTranslation[], languagesToAbbreviate: string[]) => Promise<PredictedTranslation[]>;
  trackSearch: (language: string) => Promise<boolean>;
  trackGitPull: () => Promise<boolean>;
  trackSynonymsView: (source?: 'search' | 'noResult') => Promise<boolean>;
  trackTranslationsView: (source: 'gdd' | 'synonym') => Promise<boolean>;
  trackPredictedTranslations: (source?: 'search' | 'noResult') => Promise<boolean>;
  trackPredictedTranslationsFailed: () => Promise<boolean>;
  trackAbbreviatedTranslations: () => Promise<boolean>;
  trackAbbreviatedTranslationsFailed: () => Promise<boolean>;
  trackGuideButtonClick: () => Promise<boolean>;
  trackPatchNotesButtonClick: () => Promise<boolean>;
  getAnalyticsData: () => Promise<AnalyticsData>;
  getAppVersion: () => Promise<string>;
  openExternal: (url: string) => Promise<boolean>;
  getPatchNotes: () => Promise<string>;
  getLogFilePath: () => Promise<string>;
  openLogFile: () => Promise<boolean>;
  getL10nConfig: () => Promise<L10nConfigStatus>;
  openL10nEnv: () => Promise<string>;
  suggestL10nReleaseDate: (wikiUrl: string, figmaUrls: string[]) => Promise<ReleaseDateSuggestion>;
  generateL10nStringIds: (input: L10nInput) => Promise<L10nRunResult>;
  finalizeL10nStringIds: (input: L10nInput) => Promise<L10nRunResult>;
  cancelL10nTask: () => Promise<L10nTaskState>;
  getL10nState: () => Promise<L10nTaskState>;
  onL10nStateChanged: (callback: (state: L10nTaskState) => void) => () => void;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

export {};
import {
  L10nConfigStatus,
  L10nInput,
  L10nRunResult,
  L10nTaskState,
  ReleaseDateSuggestion,
} from '../../shared/l10nTypes';
