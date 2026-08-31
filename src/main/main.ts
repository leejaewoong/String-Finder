import { app, BrowserWindow, ipcMain, dialog, clipboard, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import Store from 'electron-store';

import { logInfo, logError, getLogFilePath } from './logUtil';
import { fileService } from './fileService';
import { searchService } from './searchService';
import { gitService } from './gitService';
import { analyticsService } from './analyticsService';
import { openaiService } from './openaiService';
import { reloadEnvironment, resolveEnvPath } from './l10n/envService';
import { registerL10nIpc } from './l10n/registerL10nIpc';

const envPath = resolveEnvPath(
  app.isPackaged,
  app.getPath('appData'),
  path.resolve(__dirname, '..'),
);
reloadEnvironment(envPath);

// 4. 환경 변수 로딩 확인 로그
logInfo('[Main] .env loaded from:', envPath);
logInfo('[Main] OPENAI_API_KEY exists:', !!process.env.OPENAI_API_KEY);
logInfo('[Main] GA_MEASUREMENT_ID:', process.env.GA_MEASUREMENT_ID || 'NOT SET');
logInfo('[Main] GA_API_SECRET exists:', !!process.env.GA_API_SECRET);
logInfo('[Main] app.isPackaged:', app.isPackaged);

const store = new Store();
let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'icon.ico')
      : path.join(__dirname, 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'index.html'));
  }

  // F12 키로 개발자 도구 토글
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F12') {
      if (mainWindow?.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow?.webContents.openDevTools();
      }
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  registerIpcHandlers();
  registerL10nIpc(
    () => store.get('folderPath') as string | undefined,
    () => mainWindow,
  );

  // 저장된 경로 자동 로드
  const savedPath = store.get('folderPath') as string;
  if (savedPath) {
    fileService.loadFiles(savedPath).catch(logError);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// 앱 종료 전 세션 종료 이벤트 전송
app.on('before-quit', () => {
  analyticsService.endSession();
});

function registerIpcHandlers() {
  // 검색
  ipcMain.handle('search-strings', async (event, query, language) => {
    return searchService.search(query, language);
  });

  // 번역 확인
  ipcMain.handle('search-translations', async (event, stringId) => {
    return searchService.searchTranslations(stringId);
  });

  // 유의어 검색
  ipcMain.handle('search-synonyms', async (_event, searchQuery, targetLanguage) => {
    return searchService.searchSynonyms(searchQuery, targetLanguage);
  });

  // AI 예상 번역
  ipcMain.handle('get-predicted-translations', async (_event, query) => {
    return openaiService.getPredictedTranslations(query);
  });

  // AI 축약 번역
  ipcMain.handle('get-abbreviated-translations', async (_event, originalEnglish, formalTranslations, languagesToAbbreviate) => {
    return openaiService.getAbbreviatedTranslations(originalEnglish, formalTranslations, languagesToAbbreviate);
  });

  // 언어 목록
  ipcMain.handle('get-languages', async () => {
    return fileService.getLanguages();
  });

  // 폴더 선택
  ipcMain.handle('browse-folder-path', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // 경로 가져오기
  ipcMain.handle('get-folder-path', async () => {
    return store.get('folderPath') as string | null;
  });

  // 경로 검증
  ipcMain.handle('validate-folder-path', async (event, folderPath) => {
    return folderPath.includes('\\game-design-data\\localization\\ui') ||
           folderPath.includes('/game-design-data/localization/ui');
  });

  // 경로 설정
  ipcMain.handle('set-folder-path', async (event, folderPath) => {
    store.set('folderPath', folderPath);
    await fileService.loadFiles(folderPath);
    return true;
  });

  // Git Pull
  ipcMain.handle('git-pull', async () => {
    const folderPath = store.get('folderPath') as string;
    if (!folderPath) {
      throw new Error('경로가 설정되지 않았습니다.');
    }
    await gitService.pull(folderPath);
    await fileService.loadFiles(folderPath);
    return true;
  });

  // 마지막 업데이트 시간
  ipcMain.handle('get-last-update-time', async () => {
    const folderPath = store.get('folderPath') as string;
    if (!folderPath) {
      return null;
    }
    return gitService.getLastCommitTime(folderPath);
  });

  // 클립보드 복사
  ipcMain.handle('copy-to-clipboard', async (event, text) => {
    clipboard.writeText(text);
    return true;
  });

  // 검색 히스토리
  ipcMain.handle('save-search-history', async (event, query) => {
    let history = (store.get('searchHistory') as string[]) || [];
    history = [query, ...history.filter(q => q !== query)].slice(0, 10);
    store.set('searchHistory', history);
    return true;
  });

  ipcMain.handle('get-search-history', async () => {
    return (store.get('searchHistory') as string[]) || [];
  });

  // Analytics 이벤트 추적
  ipcMain.handle('track-search', async (_event, language) => {
    analyticsService.trackSearch(language);
    return true;
  });

  ipcMain.handle('track-git-pull', async () => {
    analyticsService.trackGitPull();
    return true;
  });

  ipcMain.handle('track-synonyms-view', async (_event, source?: 'search' | 'noResult') => {
    analyticsService.trackSynonymsView(source);
    return true;
  });

  ipcMain.handle('track-translations-view', async (_event, source: 'gdd' | 'synonym') => {
    analyticsService.trackTranslationsView(source);
    return true;
  });

  ipcMain.handle('track-predicted-translations', async (_event, source?: 'search' | 'noResult') => {
    analyticsService.trackPredictedTranslations(source);
    return true;
  });

  ipcMain.handle('track-predicted-translations-failed', async () => {
    analyticsService.trackPredictedTranslationsFailed();
    return true;
  });

  ipcMain.handle('track-abbreviated-translations', async () => {
    analyticsService.trackAbbreviatedTranslations();
    return true;
  });

  ipcMain.handle('track-abbreviated-translations-failed', async () => {
    analyticsService.trackAbbreviatedTranslationsFailed();
    return true;
  });

  ipcMain.handle('get-analytics-data', async () => {
    return analyticsService.getAnalyticsData();
  });

  ipcMain.handle('track-guide-button-click', async () => {
    analyticsService.trackGuideButtonClick();
    return true;
  });

  ipcMain.handle('track-patch-notes-button-click', async () => {
    analyticsService.trackPatchNotesButtonClick();
    return true;
  });

  // 앱 버전 가져오기
  ipcMain.handle('get-app-version', async () => {
    return app.getVersion();
  });

  // 외부 링크 열기
  ipcMain.handle('open-external', async (_event, url) => {
    await shell.openExternal(url);
    return true;
  });

  // 패치 노트 읽기
  ipcMain.handle('get-patch-notes', async () => {
    try {
      const patchNotesPath = app.isPackaged
        ? path.join(process.resourcesPath, 'PATCH_NOTES.md')  // 프로덕션: resources 폴더
        : path.join(__dirname, '../PATCH_NOTES.md');          // 개발: 프로젝트 루트
      const content = await fs.readFile(patchNotesPath, 'utf-8');
      return content;
    } catch (error) {
      logError('Failed to read PATCH_NOTES.md:', error);
      return '# 패치 노트\n\n패치 노트를 불러올 수 없습니다.';
    }
  });

  // 로그 파일 경로 가져오기
  ipcMain.handle('get-log-file-path', async () => {
    return getLogFilePath();
  });

  // 로그 파일 열기
  ipcMain.handle('open-log-file', async () => {
    const logPath = getLogFilePath();
    await shell.openPath(logPath);
    return true;
  });
}
