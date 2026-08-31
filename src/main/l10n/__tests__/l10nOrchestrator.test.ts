import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FigmaScannedFrame, FigmaScanResult } from '../figmaClient';
import { L10nInferenceRow } from '../l10nOpenAiClient';
import { L10nOrchestrator, L10nOrchestratorDependencies } from '../l10nOrchestrator';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const frames: FigmaScannedFrame[] = [{
  id: 'frame:1',
  name: '메인_외형 챌린지 선택',
  fileKey: 'file-key',
  fileTitle: 'v2612 외형 챌린지',
  attachmentName: 'frame.png',
  strings: [
    {
      delimiter: 'A', label: 'Title', locator: 'target:A', stringIdHint: 'EOM:MAIN_TITLE_0',
      tagNodeId: 'tag:A', targetNodeId: 'target:A', korean: '외형 챌린지',
      frame: { id: 'frame:1', name: '메인_외형 챌린지 선택' }, layerPath: ['메인', 'Title'],
    },
    {
      delimiter: 'B', label: 'Button', locator: 'target:B', stringIdHint: 'EOM:MAIN_BUTTON_0',
      tagNodeId: 'tag:B', targetNodeId: 'target:B', korean: '확인',
      frame: { id: 'frame:1', name: '메인_외형 챌린지 선택' }, layerPath: ['메인', 'Button'],
    },
  ],
}];

const input = {
  wikiUrl: 'https://example.atlassian.net/wiki/spaces/P/pages/123/Test',
  figmaUrls: ['https://www.figma.com/design/file-key/v2612?node-id=1-2'],
  releaseDate: '2026-12-03',
  releaseDateSource: 'auto' as const,
};

async function tempRoots() {
  const root = await mkdtemp(path.join(tmpdir(), 'string-finder-orchestrator-'));
  roots.push(root);
  const uiRoot = path.join(root, 'ui');
  await mkdir(path.join(uiRoot, 'input'), { recursive: true });
  await writeFile(path.join(uiRoot, 'input', 'ui_clan.json'), '{}');
  await writeFile(path.join(uiRoot, 'input', 'ui_common.json'), '{}');
  return { root, uiRoot, appDataPath: path.join(root, 'app-data'), tempRoot: path.join(root, 'temp') };
}

function dependencies(
  rootsInfo: Awaited<ReturnType<typeof tempRoots>>,
  storage: string,
): L10nOrchestratorDependencies & { currentStorage: () => string } {
  let currentStorage = storage;
  const page = () => ({
    id: '123', status: 'current', title: '[v2612-10] 외형 챌린지', spaceId: '1',
    version: 1, storage: currentStorage,
  });
  return {
    uiRoot: rootsInfo.uiRoot,
    appDataPath: rootsInfo.appDataPath,
    tempRoot: rootsInfo.tempRoot,
    now: () => new Date('2026-08-31T09:00:00.000Z'),
    figma: {
      scan: vi.fn(async () => ({ fileTitles: ['v2612 외형 챌린지'], frames, issues: [] })),
      exportFrame: vi.fn(async (_fileKey, _frameId, outputPath) => {
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(outputPath, new Uint8Array([1, 2, 3]));
      }),
    },
    confluence: {
      getPage: vi.fn(async () => page()),
      updatePage: vi.fn(async (_pageId, nextStorage) => {
        currentStorage = nextStorage;
        return { ...page(), version: 2 };
      }),
      uploadAttachment: vi.fn(async () => undefined),
      getChildPages: vi.fn(async () => []),
    },
    openAi: {
      infer: vi.fn(async (rows: L10nInferenceRow[]) => ({
        inferences: rows.map((row: L10nInferenceRow) => ({
          rowKey: row.rowKey,
          feature: 'CLAN',
          screen: 'MAIN',
          type: row.rowKey.includes(':A:') ? 'TITLE' as const : 'BUTTON' as const,
        })),
        issues: [],
      })),
    },
    currentStorage: () => currentStorage,
  };
}

describe('L10nOrchestrator', () => {
  it('creates a table and attachments then waits for English review when no table exists', async () => {
    const rootsInfo = await tempRoots();
    const deps = dependencies(rootsInfo, '<p>기존 본문</p>');
    const orchestrator = new L10nOrchestrator(deps);

    const result = await orchestrator.generate(input);

    expect(deps.figma.exportFrame).toHaveBeenCalledTimes(1);
    expect(deps.confluence.uploadAttachment).toHaveBeenCalledTimes(1);
    expect(deps.confluence.updatePage).toHaveBeenCalledTimes(1);
    expect(deps.currentStorage()).toContain('<th>String ID</th>');
    expect(result.state.stage).toBe('english-review');
    expect(result.state.canGenerate).toBe(true);
  });

  it('writes IDs for matched rows and keeps row mismatches as non-blocking attention items', async () => {
    const rootsInfo = await tempRoots();
    const storage = '<table><tbody>'
      + '<tr><th>구분자</th><th>국문</th><th>영문</th></tr>'
      + '<tr><td>A</td><td>외형 챌린지</td><td>APPEARANCE CHALLENGE</td></tr>'
      + '<tr><td>B</td><td>취소</td><td>CANCEL</td></tr>'
      + '</tbody></table>';
    const deps = dependencies(rootsInfo, storage);
    const orchestrator = new L10nOrchestrator(deps);

    const result = await orchestrator.generate(input);

    expect(deps.currentStorage()).toContain('CLAN:MAIN_TITLE_0');
    expect(deps.currentStorage()).not.toContain('CLAN:MAIN_BUTTON_0');
    expect(result.state.stage).toBe('wiki-review');
    expect(result.state.attentionCount).toBe(1);
    expect(result.state.issues[0].code).toBe('KOREAN_MISMATCH');
  });

  it('re-reads the wiki and writes only new JSON entries on final confirmation', async () => {
    const rootsInfo = await tempRoots();
    const storage = '<table><tbody>'
      + '<tr><th>구분자</th><th>국문</th><th>영문</th><th>String ID</th></tr>'
      + '<tr><td>A</td><td>외형 챌린지</td><td>APPEARANCE CHALLENGE</td><td></td></tr>'
      + '</tbody></table>';
    const deps = dependencies(rootsInfo, storage);
    const orchestrator = new L10nOrchestrator(deps);
    await orchestrator.generate(input);

    const result = await orchestrator.finalize(input);

    const json = JSON.parse(await readFile(path.join(rootsInfo.uiRoot, 'input', 'ui_clan.json'), 'utf8'));
    expect(json['CLAN:MAIN_TITLE_0']).toEqual({
      Text: 'APPEARANCE CHALLENGE',
      ReleaseDate: '2026-12-03',
    });
    expect(deps.confluence.getPage).toHaveBeenCalledTimes(2);
    expect(result.state.stage).toBe('complete');
    expect(result.diff).toContain('+ CLAN:MAIN_TITLE_0');
  });

  it('aborts a running task and returns to idle without writing', async () => {
    const rootsInfo = await tempRoots();
    const deps = dependencies(rootsInfo, '<p>본문</p>');
    deps.figma.scan = vi.fn(async (_urls, signal) => new Promise<FigmaScanResult>((_, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const orchestrator = new L10nOrchestrator(deps);

    const running = orchestrator.generate(input);
    orchestrator.cancel();
    await running;

    expect(orchestrator.getState().stage).toBe('idle');
    expect(deps.confluence.updatePage).not.toHaveBeenCalled();
  });
});
