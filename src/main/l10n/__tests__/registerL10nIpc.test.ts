import { beforeEach, describe, expect, it, vi } from 'vitest';
import { L10nDraft, L10nTaskState } from '../../../shared/l10nTypes';

const ipcHandlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => 'C:\\AppData'),
  },
  BrowserWindow: class {},
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, handler);
    }),
  },
  shell: { openPath: vi.fn(async () => '') },
}));

import { registerL10nIpc } from '../registerL10nIpc';

const draft: L10nDraft = {
  wikiUrl: 'https://example.atlassian.net/wiki/spaces/P/pages/123/Test',
  figmaText: 'https://www.figma.com/design/file-key/Test?node-id=1-2',
  featurePrefix: 'CLAN',
  releaseDate: '2026-12-03',
  releaseDateSource: 'auto',
};

const taskState: L10nTaskState = {
  stage: 'wiki-review',
  label: 'STRING ID 검토 중',
  taskTitle: '[v2612-10] 외형 챌린지',
  activeInput: {
    wikiUrl: draft.wikiUrl,
    figmaUrls: [draft.figmaText],
    featurePrefix: draft.featurePrefix,
    releaseDate: draft.releaseDate,
    releaseDateSource: draft.releaseDateSource,
  },
  attentionCount: 0,
  issues: [],
  stats: { total: 2, matched: 2, reused: 0, created: 2, common: 0, renumbered: 0, skipped: 0 },
  canGenerate: true,
  canFinalize: true,
  canCancel: true,
};

beforeEach(() => {
  ipcHandlers.clear();
});

describe('registerL10nIpc task persistence', () => {
  it('returns the persisted task state before the orchestrator is created', async () => {
    registerL10nIpc(
      () => undefined,
      () => null,
      { load: () => draft, save: vi.fn(), clear: vi.fn() },
      { load: () => taskState, save: vi.fn(), clear: vi.fn() },
    );

    const getState = ipcHandlers.get('l10n:get-state');
    expect(await getState?.({})).toEqual(taskState);
  });

  it('clears both the draft and persisted task when the task is reset', async () => {
    const draftPersistence = { load: () => draft, save: vi.fn(), clear: vi.fn() };
    const taskPersistence = { load: () => taskState, save: vi.fn(), clear: vi.fn() };
    registerL10nIpc(
      () => undefined,
      () => null,
      draftPersistence,
      taskPersistence,
    );

    const reset = ipcHandlers.get('l10n:reset');
    expect(await reset?.({})).toEqual(expect.objectContaining({ stage: 'idle' }));
    expect(draftPersistence.clear).toHaveBeenCalledOnce();
    expect(taskPersistence.clear).toHaveBeenCalledOnce();
  });
});
