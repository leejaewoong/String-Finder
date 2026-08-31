import { contextBridge, ipcRenderer } from 'electron';
import { L10nInput, L10nTaskState } from '../shared/l10nTypes';

// Main Process 로그를 DevTools 콘솔로 전달
ipcRenderer.on('main-process-log', (_, logData: { level: string; message: string; args: any[]; timestamp: string }) => {
  const { level, message, args, timestamp } = logData;
  const prefix = `[Main Process ${timestamp}]`;

  switch (level) {
    case 'info':
      console.log(prefix, message, ...args);
      break;
    case 'warn':
      console.warn(prefix, message, ...args);
      break;
    case 'error':
      console.error(prefix, message, ...args);
      break;
    default:
      console.log(prefix, message, ...args);
  }
});

contextBridge.exposeInMainWorld('electron', {
  searchStrings: (query: string, language: string) =>
    ipcRenderer.invoke('search-strings', query, language),

  getLanguages: () =>
    ipcRenderer.invoke('get-languages'),

  getFolderPath: () =>
    ipcRenderer.invoke('get-folder-path'),

  validateFolderPath: (path: string) =>
    ipcRenderer.invoke('validate-folder-path', path),

  setFolderPath: (path: string) =>
    ipcRenderer.invoke('set-folder-path', path),

  browseFolderPath: () =>
    ipcRenderer.invoke('browse-folder-path'),

  gitPull: () =>
    ipcRenderer.invoke('git-pull'),

  getLastUpdateTime: () =>
    ipcRenderer.invoke('get-last-update-time'),

  copyToClipboard: (text: string) =>
    ipcRenderer.invoke('copy-to-clipboard', text),

  saveSearchHistory: (query: string) =>
    ipcRenderer.invoke('save-search-history', query),

  getSearchHistory: () =>
    ipcRenderer.invoke('get-search-history'),

  searchTranslations: (stringId: string) =>
    ipcRenderer.invoke('search-translations', stringId),

  searchSynonyms: (searchQuery: string, targetLanguage: string) =>
    ipcRenderer.invoke('search-synonyms', searchQuery, targetLanguage),

  getPredictedTranslations: (query: string) =>
    ipcRenderer.invoke('get-predicted-translations', query),

  getAbbreviatedTranslations: (originalEnglish: string, formalTranslations: any[], languagesToAbbreviate: string[]) =>
    ipcRenderer.invoke('get-abbreviated-translations', originalEnglish, formalTranslations, languagesToAbbreviate),

  // Analytics
  trackSearch: (language: string) =>
    ipcRenderer.invoke('track-search', language),

  trackGitPull: () =>
    ipcRenderer.invoke('track-git-pull'),

  trackSynonymsView: (source?: 'search' | 'noResult') =>
    ipcRenderer.invoke('track-synonyms-view', source),

  trackTranslationsView: (source: 'gdd' | 'synonym') =>
    ipcRenderer.invoke('track-translations-view', source),

  trackPredictedTranslations: (source?: 'search' | 'noResult') =>
    ipcRenderer.invoke('track-predicted-translations', source),

  trackPredictedTranslationsFailed: () =>
    ipcRenderer.invoke('track-predicted-translations-failed'),

  trackAbbreviatedTranslations: () =>
    ipcRenderer.invoke('track-abbreviated-translations'),

  trackAbbreviatedTranslationsFailed: () =>
    ipcRenderer.invoke('track-abbreviated-translations-failed'),

  getAnalyticsData: () =>
    ipcRenderer.invoke('get-analytics-data'),

  trackGuideButtonClick: () =>
    ipcRenderer.invoke('track-guide-button-click'),

  trackPatchNotesButtonClick: () =>
    ipcRenderer.invoke('track-patch-notes-button-click'),

  getAppVersion: () =>
    ipcRenderer.invoke('get-app-version'),

  openExternal: (url: string) =>
    ipcRenderer.invoke('open-external', url),

  getPatchNotes: () =>
    ipcRenderer.invoke('get-patch-notes'),

  getLogFilePath: () =>
    ipcRenderer.invoke('get-log-file-path'),

  openLogFile: () =>
    ipcRenderer.invoke('open-log-file'),

  getL10nConfig: () =>
    ipcRenderer.invoke('l10n:get-config'),

  openL10nEnv: () =>
    ipcRenderer.invoke('l10n:open-env'),

  suggestL10nReleaseDate: (wikiUrl: string, figmaUrls: string[]) =>
    ipcRenderer.invoke('l10n:suggest-release-date', wikiUrl, figmaUrls),

  generateL10nStringIds: (input: L10nInput) =>
    ipcRenderer.invoke('l10n:generate', input),

  finalizeL10nStringIds: (input: L10nInput) =>
    ipcRenderer.invoke('l10n:finalize', input),

  cancelL10nTask: () =>
    ipcRenderer.invoke('l10n:cancel'),

  getL10nState: () =>
    ipcRenderer.invoke('l10n:get-state'),

  onL10nStateChanged: (callback: (state: L10nTaskState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: L10nTaskState) => callback(state);
    ipcRenderer.on('l10n:state-changed', listener);
    return () => ipcRenderer.removeListener('l10n:state-changed', listener);
  },
});
