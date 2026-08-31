import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import { L10nInput, L10nTaskState } from '../../shared/l10nTypes';
import { ConfluenceClient } from './confluenceClient';
import {
  ensureEnvFile,
  getL10nConfigStatus,
  reloadEnvironment,
  resolveEnvPath,
} from './envService';
import { FigmaClient } from './figmaClient';
import { L10nOpenAiClient } from './l10nOpenAiClient';
import { L10nOrchestrator } from './l10nOrchestrator';

function emptyState(): L10nTaskState {
  return {
    stage: 'idle',
    label: '대기 중',
    attentionCount: 0,
    issues: [],
    stats: {
      total: 0, matched: 0, reused: 0, created: 0, common: 0, renumbered: 0, skipped: 0,
    },
    canGenerate: true,
    canFinalize: false,
    canCancel: false,
  };
}

export function registerL10nIpc(
  getUiRoot: () => string | undefined,
  getMainWindow: () => BrowserWindow | null,
): void {
  const projectRoot = path.resolve(__dirname, '..');
  const envPath = resolveEnvPath(app.isPackaged, app.getPath('appData'), projectRoot);
  let orchestrator: L10nOrchestrator | undefined;
  let configurationKey = '';
  let unsubscribe: (() => void) | undefined;

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
        process.env.OPENAI_MODEL || 'gpt-4o-mini',
      ),
      uiRoot,
      appDataPath: app.getPath('appData'),
      tempRoot: path.join(app.getPath('temp'), 'String-Finder', 'l10n'),
    });
    configurationKey = nextKey;
    unsubscribe = orchestrator.subscribe((state) => {
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
  ipcMain.handle('l10n:suggest-release-date', async (_event, wikiUrl: string, figmaUrls: string[]) =>
    getOrchestrator().suggestReleaseDate(wikiUrl, figmaUrls));
  ipcMain.handle('l10n:generate', async (_event, input: L10nInput) =>
    getOrchestrator().generate(input));
  ipcMain.handle('l10n:finalize', async (_event, input: L10nInput) =>
    getOrchestrator().finalize(input));
  ipcMain.handle('l10n:cancel', async () => {
    orchestrator?.cancel();
    return orchestrator?.getState() ?? emptyState();
  });
  ipcMain.handle('l10n:get-state', async () => orchestrator?.getState() ?? emptyState());
}
