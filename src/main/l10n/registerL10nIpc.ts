import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import { L10nDraft, L10nInput, L10nTaskState } from '../../shared/l10nTypes';
import { ConfluenceClient } from './confluenceClient';
import {
  ensureEnvFile,
  getL10nConfigStatus,
  reloadEnvironment,
  resolveEnvPath,
} from './envService';
import { FigmaClient } from './figmaClient';
import { buildFeatureCatalog } from './featureCatalog';
import { loadInputFiles } from './jsonRepository';
import { L10nOpenAiClient } from './l10nOpenAiClient';
import { L10nOrchestrator } from './l10nOrchestrator';
import { normalizeL10nDraft } from './l10nDraft';
import { emptyL10nTaskState, restoreL10nTaskState } from './l10nTaskState';

interface L10nDraftPersistence {
  load(): unknown;
  save(draft: L10nDraft): void;
  clear(): void;
}

interface L10nTaskPersistence {
  load(): unknown;
  save(state: L10nTaskState): void;
  clear(): void;
}

function emptyState(): L10nTaskState {
  return emptyL10nTaskState();
}

export function registerL10nIpc(
  getUiRoot: () => string | undefined,
  getMainWindow: () => BrowserWindow | null,
  draftPersistence: L10nDraftPersistence,
  taskPersistence: L10nTaskPersistence,
): void {
  const projectRoot = path.resolve(__dirname, '..');
  const envPath = resolveEnvPath(app.isPackaged, app.getPath('appData'), projectRoot);
  let orchestrator: L10nOrchestrator | undefined;
  let configurationKey = '';
  let unsubscribe: (() => void) | undefined;
  let restoredState = restoreL10nTaskState(
    taskPersistence.load(),
    normalizeL10nDraft(draftPersistence.load()),
  );
  if (restoredState.stage !== 'idle') taskPersistence.save(restoredState);

  const getOrchestrator = (): L10nOrchestrator => {
    reloadEnvironment(envPath);
    const status = getL10nConfigStatus(envPath);
    if (!status.configured) {
      throw new Error(`L10N 설정이 필요합니다: ${status.missing.join(', ')}`);
    }
    const uiRoot = getUiRoot() ?? '';
    const nextKey = [
      uiRoot,
      process.env.FIGMA_API_TOKEN,
      process.env.CONFLUENCE_BASE_URL,
      process.env.CONFLUENCE_EMAIL,
      process.env.CONFLUENCE_API_TOKEN,
      process.env.OPENAI_API_KEY,
      process.env.OPENAI_MODEL,
      process.env.OPENAI_REASONING_EFFORT,
    ].join('\u0000');
    if (orchestrator && configurationKey === nextKey) return orchestrator;

    unsubscribe?.();
    orchestrator = new L10nOrchestrator({
      figma: new FigmaClient(process.env.FIGMA_API_TOKEN!),
      confluence: new ConfluenceClient(
        process.env.CONFLUENCE_BASE_URL!,
        process.env.CONFLUENCE_EMAIL!,
        process.env.CONFLUENCE_API_TOKEN!,
      ),
      openAi: new L10nOpenAiClient(
        process.env.OPENAI_API_KEY!,
        process.env.OPENAI_MODEL || 'gpt-5.6-terra',
      ),
      uiRoot,
      appDataPath: app.getPath('appData'),
      tempRoot: path.join(app.getPath('temp'), 'String-Finder', 'l10n'),
    }, restoredState);
    configurationKey = nextKey;
    unsubscribe = orchestrator.subscribe((state) => {
      restoredState = state;
      taskPersistence.save(state);
      getMainWindow()?.webContents.send('l10n:state-changed', state);
    });
    return orchestrator;
  };

  ipcMain.handle('l10n:get-config', async () => {
    reloadEnvironment(envPath);
    return getL10nConfigStatus(envPath);
  });
  ipcMain.handle('l10n:open-env', async () => {
    const ensuredPath = await ensureEnvFile(envPath);
    await shell.openPath(ensuredPath);
    return ensuredPath;
  });
  ipcMain.handle('l10n:get-draft', async () => normalizeL10nDraft(draftPersistence.load()));
  ipcMain.handle('l10n:save-draft', async (_event, draft: L10nDraft) => {
    draftPersistence.save(normalizeL10nDraft(draft));
  });
  ipcMain.handle('l10n:get-feature-options', async () => {
    const uiRoot = getUiRoot();
    if (!uiRoot) throw new Error('GDD UI 폴더 경로가 설정되지 않았습니다.');
    return buildFeatureCatalog((await loadInputFiles(uiRoot)).files);
  });
  ipcMain.handle('l10n:suggest-release-date', async (_event, wikiUrl: string, figmaUrls: string[]) =>
    getOrchestrator().suggestReleaseDate(wikiUrl, figmaUrls));
  ipcMain.handle('l10n:generate', async (_event, input: L10nInput) =>
    getOrchestrator().generate(input));
  ipcMain.handle('l10n:finalize', async (_event, input: L10nInput) =>
    getOrchestrator().finalize(input));
  ipcMain.handle('l10n:cancel', async () => {
    if (orchestrator) {
      orchestrator.cancel();
      restoredState = orchestrator.getState();
    } else if (restoredState.canCancel && restoredState.stage !== 'json-applying') {
      restoredState = emptyState();
    }
    const state = restoredState;
    if (state.stage === 'idle') {
      draftPersistence.clear();
      taskPersistence.clear();
    }
    return state;
  });
  ipcMain.handle('l10n:reset', async () => {
    orchestrator?.reset();
    restoredState = emptyState();
    draftPersistence.clear();
    taskPersistence.clear();
    return restoredState;
  });
  ipcMain.handle('l10n:get-state', async () => orchestrator?.getState() ?? restoredState);
}
