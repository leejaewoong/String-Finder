import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FigmaScannedFrame, FigmaScanResult } from '../figmaClient';
import {
  createL10nSyncMetadata,
  createL10nTable,
  findL10nTable,
  L10nSyncMetadata,
} from '../confluenceTable';
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
      screenContext: [{
        name: 'Tab Item', type: 'INSTANCE', path: ['메인', 'Tab', 'Tab Item'],
        text: '외형 챌린지', states: { Selected: true },
      }],
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
  featurePrefix: 'CLAN',
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
  await writeFile(path.join(uiRoot, 'input', 'ui_dev.json'), '{}');
  return { root, uiRoot, appDataPath: path.join(root, 'app-data'), tempRoot: path.join(root, 'temp') };
}

function dependencies(
  rootsInfo: Awaited<ReturnType<typeof tempRoots>>,
  storage: string,
  initialMetadata?: L10nSyncMetadata,
): L10nOrchestratorDependencies & {
  currentStorage: () => string;
  currentMetadata: () => L10nSyncMetadata | undefined;
} {
  let currentStorage = storage;
  let currentMetadata = initialMetadata;
  let metadataVersion = initialMetadata ? 1 : undefined;
  const getContentProperty = async <T>() => currentMetadata
    ? { value: currentMetadata as T, version: metadataVersion! }
    : undefined;
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
      setPageFullWidth: vi.fn(async () => undefined),
      getContentProperty,
      setContentProperty: vi.fn(async (_pageId, _key, value) => {
        currentMetadata = value as L10nSyncMetadata;
        metadataVersion = (metadataVersion ?? 0) + 1;
      }),
    },
    openAi: {
      infer: vi.fn(async (rows: L10nInferenceRow[], featureCandidates: string[]) => ({
        inferences: rows.map((row: L10nInferenceRow) => ({
          rowKey: row.rowKey,
          feature: featureCandidates[0],
          screen: 'MAIN',
          type: row.rowKey.includes(':A:') ? 'TITLE' as const : 'BUTTON' as const,
        })),
        issues: [],
      })),
    },
    currentStorage: () => currentStorage,
    currentMetadata: () => currentMetadata,
  };
}

describe('L10nOrchestrator', () => {
  it('creates a left-aligned table on a full-width page and waits for English review', async () => {
    const rootsInfo = await tempRoots();
    await writeFile(path.join(rootsInfo.uiRoot, 'input', 'ui_common.json'), JSON.stringify({
      'COMMON:LEGACY_TITLE': {
        Text: 'APPEARANCE CHALLENGE',
        ReleaseDate: '2026-01-01',
      },
    }));
    await writeFile(path.join(rootsInfo.uiRoot, 'ui_ko.json'), JSON.stringify({
      'COMMON:LEGACY_TITLE': '외형 챌린지',
    }));
    const deps = dependencies(rootsInfo, '<p>기존 본문</p>');
    const orchestrator = new L10nOrchestrator(deps);
    const labels: string[] = [];
    orchestrator.subscribe((state) => labels.push(state.label));

    const result = await orchestrator.generate(input);

    expect(deps.figma.exportFrame).toHaveBeenCalledTimes(1);
    expect(deps.confluence.uploadAttachment).toHaveBeenCalledTimes(1);
    expect(deps.confluence.setPageFullWidth).toHaveBeenCalledWith('123', expect.any(AbortSignal));
    expect(deps.confluence.updatePage).toHaveBeenCalledTimes(1);
    expect(deps.confluence.setContentProperty).toHaveBeenCalledWith(
      '123',
      'string-finder-l10n-sync',
      expect.objectContaining({ schemaVersion: 1 }),
      undefined,
      expect.any(AbortSignal),
    );
    expect(deps.currentMetadata()?.rows).toHaveLength(2);
    expect(deps.currentStorage()).toContain('<th>String ID</th>');
    expect(deps.currentStorage()).toContain('<td>COMMON:LEGACY_TITLE</td>');
    expect(deps.currentStorage()).toContain('<td>기존 String ID 사용</td>');
    expect(deps.openAi.infer).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          tagLabel: 'Title',
          layerPath: ['메인', 'Title'],
          screenContext: [expect.objectContaining({
            name: 'Tab Item',
            states: { Selected: true },
          })],
        }),
      ]),
      ['CLAN'],
      expect.any(AbortSignal),
    );
    expect(result.state.stage).toBe('english-review');
    expect(result.state.label).toBe('영문 검수 대기중');
    expect(result.state.taskTitle).toBe('[v2612-10] 외형 챌린지');
    expect(result.state.activeInput).toEqual(input);
    expect(result.state.canGenerate).toBe(true);
    expect(result.state.canCancel).toBe(true);
    expect(labels).toContain('STRING ID 생성 중');
    expect(labels).toContain('위키 작성 중');
  });

  it('starts with a restored task state until another execution replaces it', async () => {
    const rootsInfo = await tempRoots();
    const deps = dependencies(rootsInfo, '<p>기존 본문</p>');
    const restoredState = {
      stage: 'wiki-review' as const,
      label: 'STRING ID 검토 중',
      taskTitle: '[v2612-10] 복원된 작업',
      activeInput: input,
      attentionCount: 0,
      issues: [],
      stats: { total: 2, matched: 2, reused: 0, created: 2, common: 0, renumbered: 0, skipped: 0 },
      lastGeneratedAt: '2026-09-04T01:00:00.000Z',
      canGenerate: true,
      canFinalize: true,
      canCancel: true,
    };

    const orchestrator = new L10nOrchestrator(deps, restoredState);

    expect(orchestrator.getState()).toEqual(restoredState);
  });

  it('uses the selected feature and its key-derived target mapping', async () => {
    const rootsInfo = await tempRoots();
    await writeFile(path.join(rootsInfo.uiRoot, 'input', 'ui_lobby.json'), JSON.stringify({
      'REPUTATION:REFERENCE_BODY_0': {
        Text: 'REFERENCE',
        ReleaseDate: '2026-01-01',
      },
    }));
    const storage = '<table><tbody>'
      + '<tr><th>구분자</th><th>국문</th><th>영문</th></tr>'
      + '<tr><td>A</td><td>외형 챌린지</td><td>APPEARANCE CHALLENGE</td></tr>'
      + '</tbody></table>';
    const deps = dependencies(rootsInfo, storage);
    const orchestrator = new L10nOrchestrator(deps);

    await orchestrator.generate({ ...input, featurePrefix: 'REPUTATION' });

    expect(deps.openAi.infer).toHaveBeenCalledWith(
      expect.any(Array),
      ['REPUTATION'],
      expect.any(AbortSignal),
    );
    expect(deps.currentStorage()).toContain('REPUTATION:MAIN_TITLE_0');
  });

  it('updates changed Korean without generating a new ID for a non-reused row', async () => {
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
    expect(deps.currentStorage()).toContain('<td>확인</td>');
    expect(deps.figma.exportFrame).toHaveBeenCalledTimes(1);
    expect(deps.confluence.uploadAttachment).toHaveBeenCalledTimes(1);
    expect(result.state.stage).toBe('wiki-review');
    expect(result.state.label).toBe('STRING ID 검토 중');
    expect(result.state.attentionCount).toBe(0);
  });

  it('refreshes tagged frame images even when strings and tags are unchanged', async () => {
    const rootsInfo = await tempRoots();
    const storage = createL10nTable('', frames);
    const deps = dependencies(rootsInfo, storage, createL10nSyncMetadata(frames));
    const orchestrator = new L10nOrchestrator(deps);

    await orchestrator.generate(input);

    expect(deps.figma.exportFrame).toHaveBeenCalledTimes(1);
    expect(deps.figma.exportFrame).toHaveBeenCalledWith(
      'file-key',
      'frame:1',
      expect.stringMatching(/frame\.png$/),
      expect.any(AbortSignal),
    );
    expect(deps.confluence.uploadAttachment).toHaveBeenCalledTimes(1);
  });

  it('refreshes changed Figma text and its frame while regenerating only reused IDs', async () => {
    const rootsInfo = await tempRoots();
    await writeFile(path.join(rootsInfo.uiRoot, 'input', 'ui_common.json'), JSON.stringify({
      'COMMON:OLD_TITLE': {
        Text: 'OLD TITLE',
        ReleaseDate: '2026-01-01',
      },
    }));
    await writeFile(path.join(rootsInfo.uiRoot, 'ui_ko.json'), JSON.stringify({
      'COMMON:OLD_TITLE': '이전 제목',
    }));
    const storage = '<table><tbody>'
      + '<tr><th>이미지</th><th>구분자</th><th>String ID</th><th>영문</th><th>국문</th><th>비고</th></tr>'
      + '<tr><td rowspan="2"><ac:image><ri:attachment ri:filename="frame.png"/></ac:image></td><td>A</td><td>COMMON:OLD_TITLE</td><td>NEW TITLE</td><td>이전 제목</td><td>기존 String ID 사용</td></tr>'
      + '<tr><td>B</td><td>CLAN:MAIN_BUTTON_7</td><td>CONFIRM</td><td>이전 버튼</td><td></td></tr>'
      + '</tbody></table>';
    const deps = dependencies(rootsInfo, storage);
    const orchestrator = new L10nOrchestrator(deps);

    const result = await orchestrator.generate(input);

    expect(deps.figma.exportFrame).toHaveBeenCalledTimes(1);
    expect(deps.confluence.uploadAttachment).toHaveBeenCalledTimes(1);
    expect(deps.currentStorage()).toContain('<td>외형 챌린지</td>');
    expect(deps.currentStorage()).toContain('<td>확인</td>');
    expect(deps.currentStorage()).toContain('<td>NEW TITLE</td>');
    expect(deps.currentStorage()).toContain('<td>CLAN:MAIN_TITLE_0</td>');
    expect(deps.currentStorage()).toContain('<td>CLAN:MAIN_BUTTON_7</td>');
    expect(deps.currentStorage()).not.toContain('기존 String ID 사용');
    expect(result.state.issues.map((issue) => issue.code)).not.toContain('KOREAN_MISMATCH');
  });

  it('keeps JSON confirmation available when every changed row preserves its candidate ID', async () => {
    const rootsInfo = await tempRoots();
    const storage = '<table><tbody>'
      + '<tr><th>이미지</th><th>구분자</th><th>String ID</th><th>영문</th><th>국문</th><th>비고</th></tr>'
      + '<tr><td><ac:image><ri:attachment ri:filename="frame.png"/></ac:image></td><td>B</td><td>CLAN:MAIN_BUTTON_7</td><td>CONFIRM</td><td>이전 버튼</td><td></td></tr>'
      + '</tbody></table>';
    const deps = dependencies(rootsInfo, storage);
    const changedFrames = [{ ...frames[0], strings: [frames[0].strings[1]] }];
    deps.figma.scan = vi.fn(async () => ({
      fileTitles: ['v2612 외형 챌린지'],
      frames: changedFrames,
      issues: [],
    }));
    const orchestrator = new L10nOrchestrator(deps);

    const result = await orchestrator.generate(input);

    expect(deps.currentStorage()).toContain('<td>확인</td>');
    expect(deps.currentStorage()).toContain('<td>CLAN:MAIN_BUTTON_7</td>');
    expect(result.state.stage).toBe('wiki-review');
    expect(result.state.canFinalize).toBe(true);
  });

  it('adds new tagged rows and frames, uploads each changed frame once, and persists node metadata', async () => {
    const rootsInfo = await tempRoots();
    const initialFrames = [{ ...structuredClone(frames[0]), strings: [structuredClone(frames[0].strings[0])] }];
    const storage = '<table data-table-width="1800" data-layout="align-start"><tbody>'
      + '<tr><th>이미지</th><th>구분자</th><th>String ID</th><th>영문</th><th>국문</th><th>비고</th></tr>'
      + '<tr><td><ac:image><ri:attachment ri:filename="frame.png"/></ac:image></td><td>A</td><td>CLAN:MAIN_TITLE_0</td><td>APPEARANCE</td><td>외형 챌린지</td><td>사용자 메모</td></tr>'
      + '</tbody></table>';
    const deps = dependencies(rootsInfo, storage, createL10nSyncMetadata(initialFrames));
    const currentFirst = structuredClone(frames[0]);
    const currentSecond: FigmaScannedFrame = {
      ...structuredClone(frames[0]),
      id: 'frame:2',
      name: '신규 화면',
      attachmentName: 'frame-2.png',
      strings: [{
        ...structuredClone(frames[0].strings[0]),
        tagNodeId: 'tag:frame-2',
        targetNodeId: 'target:frame-2',
        locator: 'target:frame-2',
        korean: '신규 화면 제목',
        frame: { id: 'frame:2', name: '신규 화면' },
      }],
    };
    deps.figma.scan = vi.fn(async () => ({
      fileTitles: ['v2612 외형 챌린지'],
      frames: [currentFirst, currentSecond],
      issues: [],
    }));
    const orchestrator = new L10nOrchestrator(deps);

    await orchestrator.generate(input);

    expect(deps.figma.exportFrame).toHaveBeenCalledTimes(2);
    expect(deps.confluence.uploadAttachment).toHaveBeenCalledTimes(2);
    expect(findL10nTable(deps.currentStorage())?.rows).toHaveLength(3);
    expect(deps.currentMetadata()?.rows.map((row) => row.targetNodeId)).toEqual([
      'target:A',
      'target:B',
      'target:frame-2',
    ]);
  });

  it('keeps an untagged wiki row and its note, clears only its delimiter, and reports it for review', async () => {
    const rootsInfo = await tempRoots();
    const storage = '<table data-table-width="1800" data-layout="align-start"><tbody>'
      + '<tr><th>이미지</th><th>구분자</th><th>String ID</th><th>영문</th><th>국문</th><th>비고</th></tr>'
      + '<tr><td rowspan="2"><ac:image><ri:attachment ri:filename="frame.png"/></ac:image></td><td>A</td><td>CLAN:MAIN_TITLE_0</td><td>APPEARANCE</td><td>외형 챌린지</td><td></td></tr>'
      + '<tr><td>B</td><td>CLAN:MAIN_BUTTON_0</td><td>CONFIRM</td><td>확인</td><td>사용자 메모</td></tr>'
      + '</tbody></table>';
    const deps = dependencies(rootsInfo, storage, createL10nSyncMetadata(frames));
    deps.figma.scan = vi.fn(async () => ({
      fileTitles: ['v2612 외형 챌린지'],
      frames: [{ ...structuredClone(frames[0]), strings: [structuredClone(frames[0].strings[0])] }],
      issues: [],
    }));
    const orchestrator = new L10nOrchestrator(deps);

    const result = await orchestrator.generate(input);
    const table = findL10nTable(deps.currentStorage())!;
    const missing = table.rows.find((row) => row.korean === '확인');

    expect(missing).toMatchObject({
      delimiter: '',
      english: 'CONFIRM',
      stringId: 'CLAN:MAIN_BUTTON_0',
      note: '사용자 메모',
    });
    expect(result.state.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'FIGMA_TAG_MISSING', korean: '확인' }),
    ]));
    expect(deps.openAi.infer).toHaveBeenCalledWith(
      [expect.objectContaining({ korean: '외형 챌린지' })],
      ['CLAN'],
      expect.any(AbortSignal),
    );
  });

  it('renumbers an active row when its ID conflicts with a Figma-tag-missing row', async () => {
    const rootsInfo = await tempRoots();
    const storage = '<table data-table-width="1800" data-layout="align-start"><tbody>'
      + '<tr><th>이미지</th><th>구분자</th><th>String ID</th><th>영문</th><th>국문</th><th>비고</th></tr>'
      + '<tr><td rowspan="2"><ac:image><ri:attachment ri:filename="frame.png"/></ac:image></td><td>A</td><td>CLAN:MAIN_BUTTON_0</td><td>PLAY</td><td>외형 챌린지</td><td></td></tr>'
      + '<tr><td>B</td><td>CLAN:MAIN_BUTTON_0</td><td>STOP</td><td>확인</td><td>사용자 메모</td></tr>'
      + '</tbody></table>';
    const deps = dependencies(rootsInfo, storage, createL10nSyncMetadata(frames));
    deps.figma.scan = vi.fn(async () => ({
      fileTitles: ['v2612 외형 챌린지'],
      frames: [{ ...structuredClone(frames[0]), strings: [structuredClone(frames[0].strings[0])] }],
      issues: [],
    }));
    deps.openAi.infer = vi.fn(async (rows) => ({
      inferences: rows.map((candidate: L10nInferenceRow) => ({
        rowKey: candidate.rowKey,
        feature: 'CLAN',
        screen: 'MAIN',
        type: 'BUTTON' as const,
      })),
      issues: [],
    }));
    const orchestrator = new L10nOrchestrator(deps);

    await orchestrator.generate(input);

    const table = findL10nTable(deps.currentStorage())!;
    expect(table.rows.find((row) => row.korean === '외형 챌린지')?.stringId)
      .toBe('CLAN:MAIN_BUTTON_1');
    expect(table.rows.find((row) => row.korean === '확인')).toMatchObject({
      delimiter: '',
      stringId: 'CLAN:MAIN_BUTTON_0',
      note: '사용자 메모',
    });
  });

  it('surfaces a wiki metadata mismatch in the review list', async () => {
    const rootsInfo = await tempRoots();
    const storage = '<table data-table-width="1800" data-layout="align-start"><tbody>'
      + '<tr><th>이미지</th><th>구분자</th><th>String ID</th><th>영문</th><th>국문</th><th>비고</th></tr>'
      + '<tr><td rowspan="2"><ac:image><ri:attachment ri:filename="frame.png"/></ac:image></td><td>A</td><td></td><td></td><td>외형 챌린지</td><td></td></tr>'
      + '<tr><td>B</td><td></td><td></td><td>확인</td><td></td></tr>'
      + '</tbody></table>';
    const metadata = createL10nSyncMetadata(frames);
    metadata.rows.pop();
    const deps = dependencies(rootsInfo, storage, metadata);
    const orchestrator = new L10nOrchestrator(deps);

    const result = await orchestrator.generate(input);

    expect(result.state.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WIKI_METADATA_MISMATCH' }),
    ]));
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

    vi.mocked(deps.figma.exportFrame).mockClear();
    vi.mocked(deps.confluence.uploadAttachment).mockClear();

    const result = await orchestrator.finalize(input);

    const json = JSON.parse(await readFile(path.join(rootsInfo.uiRoot, 'input', 'ui_clan.json'), 'utf8'));
    expect(json['CLAN:MAIN_TITLE_0']).toEqual({
      Text: 'APPEARANCE CHALLENGE',
      ReleaseDate: '2026-12-03',
    });
    expect(deps.confluence.getPage).toHaveBeenCalledTimes(2);
    expect(deps.figma.exportFrame).toHaveBeenCalledTimes(1);
    expect(deps.confluence.uploadAttachment).toHaveBeenCalledTimes(1);
    expect(result.state.stage).toBe('complete');
    expect(result.state.label).toBe('작업 완료');
    expect(result.state.taskTitle).toBe('[v2612-10] 외형 챌린지');
    expect(result.state.canGenerate).toBe(false);
    expect(result.diff).toContain('+ CLAN:MAIN_TITLE_0');

    orchestrator.reset();

    expect(orchestrator.getState()).toMatchObject({
      stage: 'idle',
      label: '',
    });
    expect(orchestrator.getState().taskTitle).toBeUndefined();
  });

  it('uses Target Node metadata during JSON confirmation when frames reuse delimiters', async () => {
    const rootsInfo = await tempRoots();
    const firstFrame = { ...structuredClone(frames[0]), strings: [structuredClone(frames[0].strings[0])] };
    const secondFrame: FigmaScannedFrame = {
      ...structuredClone(firstFrame),
      id: 'frame:2',
      name: '두 번째 화면',
      attachmentName: 'frame-2.png',
      strings: [{
        ...structuredClone(firstFrame.strings[0]),
        tagNodeId: 'tag:second',
        targetNodeId: 'target:second',
        locator: 'target:second',
        korean: '두 번째 제목',
        frame: { id: 'frame:2', name: '두 번째 화면' },
      }],
    };
    const storage = '<table data-table-width="1800" data-layout="align-start"><tbody>'
      + '<tr><th>이미지</th><th>구분자</th><th>String ID</th><th>영문</th><th>국문</th><th>비고</th></tr>'
      + '<tr><td><ac:image><ri:attachment ri:filename="frame.png"/></ac:image></td><td>A</td><td>CLAN:FIRST_TITLE_0</td><td>FIRST</td><td>외형 챌린지</td><td></td></tr>'
      + '<tr><td><ac:image><ri:attachment ri:filename="frame-2.png"/></ac:image></td><td>A</td><td>CLAN:SECOND_TITLE_0</td><td>SECOND</td><td>두 번째 제목</td><td></td></tr>'
      + '</tbody></table>';
    const deps = dependencies(
      rootsInfo,
      storage,
      createL10nSyncMetadata([firstFrame, secondFrame]),
    );
    deps.figma.scan = vi.fn(async () => ({
      fileTitles: ['v2612 외형 챌린지'],
      frames: [secondFrame, firstFrame],
      issues: [],
    }));
    const orchestrator = new L10nOrchestrator(deps);

    await orchestrator.finalize(input);

    const json = JSON.parse(await readFile(path.join(rootsInfo.uiRoot, 'input', 'ui_clan.json'), 'utf8'));
    expect(json).toMatchObject({
      'CLAN:FIRST_TITLE_0': { Text: 'FIRST', ReleaseDate: '2026-12-03' },
      'CLAN:SECOND_TITLE_0': { Text: 'SECOND', ReleaseDate: '2026-12-03' },
    });
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
