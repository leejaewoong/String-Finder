import { describe, expect, it } from 'vitest';
import { FigmaScannedFrame } from '../figmaClient';
import {
  applyFigmaSourceUpdates,
  applyStringIdUpdates,
  compareWikiRows,
  createL10nTable,
  createL10nSyncMetadata,
  findL10nTable,
} from '../confluenceTable';

const frames: FigmaScannedFrame[] = [
  {
    id: 'frame:1',
    name: '메인_외형 챌린지 선택',
    fileKey: 'file-key',
    fileTitle: 'v2612 외형 챌린지',
    attachmentName: 'frame.png',
    strings: [
      {
        delimiter: 'A',
        label: 'Title',
        locator: 'target:A',
        stringIdHint: 'FEATURE:MAIN_TITLE_0',
        tagNodeId: 'tag:A',
        targetNodeId: 'target:A',
        korean: '외형 챌린지',
        frame: { id: 'frame:1', name: '메인_외형 챌린지 선택' },
        layerPath: ['스펙 페이지', '메인_외형 챌린지 선택', 'Title'],
      },
      {
        delimiter: 'B',
        label: 'Button',
        locator: 'target:B',
        stringIdHint: 'FEATURE:MAIN_BUTTON_0',
        tagNodeId: 'tag:B',
        targetNodeId: 'target:B',
        korean: '확인',
        frame: { id: 'frame:1', name: '메인_외형 챌린지 선택' },
        layerPath: ['스펙 페이지', '메인_외형 챌린지 선택', 'Button'],
      },
    ],
  },
];

describe('findL10nTable', () => {
  it('finds only a table containing Korean and English headers', () => {
    const storage = '<table><tbody><tr><th>국문</th><th>영문</th></tr>'
      + '<tr><td>확인</td><td>Confirm</td></tr></tbody></table>';

    expect(findL10nTable(storage)).toMatchObject({
      tableIndex: 0,
      columns: { korean: 0, english: 1 },
      hasStringIdColumn: false,
    });
    expect(findL10nTable('<table><tr><th>이름</th></tr></table>')).toBeNull();
  });
});

describe('createL10nTable', () => {
  it('appends an image-grouped localization table while preserving existing content', () => {
    const result = createL10nTable('<p>기존 본문</p>', frames);

    expect(result).toContain('<p>기존 본문</p>');
    expect(result).toContain('<table data-table-width="1800" data-layout="align-start"><tbody>');
    expect(result).toContain('<th>이미지</th><th>구분자</th><th>String ID</th><th>영문</th><th>국문</th><th>비고</th>');
    expect(result).toContain('rowspan="2"');
    expect(result).toContain('ri:filename="frame.png"');
    expect(result.match(/ri:filename="frame\.png"/g)).toHaveLength(1);
    expect(result).toContain('<td>외형 챌린지</td>');
    expect(result).toContain('<td>확인</td>');
  });
});

describe('applyStringIdUpdates', () => {
  it('adds the String ID and note columns for a reused existing key', () => {
    const storage = '<p>본문</p><table><tbody>'
      + '<tr><th>구분자</th><th>국문</th><th>영문</th></tr>'
      + '<tr><td>A</td><td>외형 챌린지</td><td>Appearance Challenge</td></tr>'
      + '</tbody></table>';

    const result = applyStringIdUpdates(storage, [{
      rowKey: '0:A:0',
      stringId: 'EOM:MAIN_TITLE_0',
      note: '기존 String ID 사용',
    }]);

    expect(result).toContain('<th>String ID</th>');
    expect(result).toContain('<th>비고</th>');
    expect(result).toContain('<td>EOM:MAIN_TITLE_0</td>');
    expect(result).toContain('<td>기존 String ID 사용</td>');
    expect(result).toContain('<p>본문</p>');
  });
});

describe('applyFigmaSourceUpdates', () => {
  it('updates Korean from Figma and resets only rows that reuse an existing ID', () => {
    const storage = '<table><tbody>'
      + '<tr><th>이미지</th><th>구분자</th><th>String ID</th><th>영문</th><th>국문</th><th>비고</th></tr>'
      + '<tr><td rowspan="2"><ac:image><ri:attachment ri:filename="frame.png"/></ac:image></td><td>A</td><td>COMMON:OLD_TITLE</td><td>Appearance Challenge</td><td>이전 제목</td><td>기존 String ID 사용</td></tr>'
      + '<tr><td>B</td><td>CLAN:MAIN_BUTTON_7</td><td>Confirm</td><td>이전 버튼</td><td>사용자 메모</td></tr>'
      + '</tbody></table>';

    const result = applyFigmaSourceUpdates(storage, frames);
    const table = findL10nTable(result.storage)!;

    expect(table.rows).toEqual([
      expect.objectContaining({
        rowKey: '0:A:0',
        korean: '외형 챌린지',
        english: 'Appearance Challenge',
        stringId: '',
        note: '',
      }),
      expect.objectContaining({
        rowKey: '0:B:1',
        korean: '확인',
        english: 'Confirm',
        stringId: 'CLAN:MAIN_BUTTON_7',
        note: '사용자 메모',
      }),
    ]);
    expect(result.preservedStringIdRowKeys).toEqual(new Set(['0:B:1']));
    expect(result.changedFrames).toEqual([frames[0]]);
  });

  it('matches repeated delimiters by Target Node metadata instead of frame order', () => {
    const secondFrame: FigmaScannedFrame = {
      ...structuredClone(frames[0]),
      id: 'frame:2',
      name: '두 번째 화면',
      attachmentName: 'frame-2.png',
      strings: [{
        ...structuredClone(frames[0].strings[0]),
        delimiter: 'A',
        tagNodeId: 'tag:second-a',
        targetNodeId: 'target:second-a',
        locator: 'target:second-a',
        korean: '두 번째 제목',
        frame: { id: 'frame:2', name: '두 번째 화면' },
      }],
    };
    let storage = createL10nTable('', [frames[0], secondFrame]);
    storage = applyStringIdUpdates(storage, [
      { rowKey: '0:A:0', stringId: 'CLAN:FIRST_TITLE_0' },
      { rowKey: '1:A:2', stringId: 'CLAN:SECOND_TITLE_0' },
    ]);
    const metadata = createL10nSyncMetadata([frames[0], secondFrame]);
    const updatedFirst = structuredClone(frames[0]);
    updatedFirst.strings[0].korean = '첫 번째 제목 변경';
    const updatedSecond = structuredClone(secondFrame);
    updatedSecond.strings[0].korean = '두 번째 제목 변경';

    const result = applyFigmaSourceUpdates(
      storage,
      [updatedSecond, updatedFirst],
      metadata,
    );
    const table = findL10nTable(result.storage)!;
    const rowsByTarget = new Map(result.metadata.rows.map((item, index) => [
      item.targetNodeId,
      table.rows[index],
    ]));

    expect(rowsByTarget.get('target:A')).toMatchObject({
      korean: '첫 번째 제목 변경',
      stringId: 'CLAN:FIRST_TITLE_0',
    });
    expect(rowsByTarget.get('target:second-a')).toMatchObject({
      korean: '두 번째 제목 변경',
      stringId: 'CLAN:SECOND_TITLE_0',
    });
  });

  it('migrates repeated delimiters by the app-generated frame attachment name', () => {
    const secondFrame: FigmaScannedFrame = {
      ...structuredClone(frames[0]),
      id: 'frame:2',
      name: '두 번째 화면',
      attachmentName: 'frame-2.png',
      strings: [{
        ...structuredClone(frames[0].strings[0]),
        delimiter: 'A',
        tagNodeId: 'tag:second-a',
        targetNodeId: 'target:second-a',
        locator: 'target:second-a',
        korean: '두 번째 제목',
        frame: { id: 'frame:2', name: '두 번째 화면' },
      }],
    };
    let storage = createL10nTable('', [frames[0], secondFrame]);
    storage = applyStringIdUpdates(storage, [
      { rowKey: '0:A:0', stringId: 'CLAN:FIRST_TITLE_0' },
      { rowKey: '1:A:2', stringId: 'CLAN:SECOND_TITLE_0' },
    ]);

    const result = applyFigmaSourceUpdates(storage, [secondFrame, frames[0]]);
    const table = findL10nTable(result.storage)!;
    const rowsByTarget = new Map(result.metadata.rows.map((item, index) => [
      item.targetNodeId,
      table.rows[index],
    ]));

    expect(rowsByTarget.get('target:A')?.stringId).toBe('CLAN:FIRST_TITLE_0');
    expect(rowsByTarget.get('target:second-a')?.stringId).toBe('CLAN:SECOND_TITLE_0');
  });

  it('adds new tagged strings and new tag-bearing frames without changing existing cells', () => {
    const storage = applyStringIdUpdates(createL10nTable('', frames), [{
      rowKey: '0:A:0',
      stringId: 'CLAN:MAIN_TITLE_0',
    }]);
    const metadata = createL10nSyncMetadata(frames);
    const currentFirst = structuredClone(frames[0]);
    currentFirst.strings.push({
      ...structuredClone(currentFirst.strings[1]),
      delimiter: 'C',
      tagNodeId: 'tag:C',
      targetNodeId: 'target:C',
      locator: 'target:C',
      korean: '신규 버튼',
    });
    const newFrame: FigmaScannedFrame = {
      ...structuredClone(currentFirst),
      id: 'frame:2',
      name: '신규 화면',
      attachmentName: 'frame-2.png',
      strings: [{
        ...structuredClone(currentFirst.strings[0]),
        delimiter: 'A',
        tagNodeId: 'tag:frame-2-a',
        targetNodeId: 'target:frame-2-a',
        locator: 'target:frame-2-a',
        korean: '신규 화면 제목',
        frame: { id: 'frame:2', name: '신규 화면' },
      }],
    };

    const result = applyFigmaSourceUpdates(storage, [currentFirst, newFrame], metadata);
    const table = findL10nTable(result.storage)!;

    expect(table.rows).toHaveLength(4);
    expect(table.rows[0]).toMatchObject({
      korean: '외형 챌린지',
      stringId: 'CLAN:MAIN_TITLE_0',
    });
    expect(table.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ delimiter: 'C', korean: '신규 버튼', english: '', stringId: '' }),
      expect.objectContaining({ delimiter: 'A', korean: '신규 화면 제목', english: '', stringId: '' }),
    ]));
    expect(result.changedFrames.map((frame) => frame.id).sort()).toEqual(['frame:1', 'frame:2']);
    expect(result.storage).toContain('rowspan="3"');
    expect(result.issues.map((issue) => issue.code)).not.toContain('WIKI_ROW_MISSING');
  });

  it('moves preserved data with its Target Node and keeps an untagged row with a blank delimiter', () => {
    const storage = '<table data-table-width="1800" data-layout="align-start"><tbody>'
      + '<tr><th>이미지</th><th>구분자</th><th>String ID</th><th>영문</th><th>국문</th><th>비고</th></tr>'
      + '<tr><td rowspan="2"><ac:image><ri:attachment ri:filename="frame.png"/></ac:image></td><td>A</td><td>CLAN:MAIN_TITLE_0</td><td>APPEARANCE</td><td>외형 챌린지</td><td></td></tr>'
      + '<tr><td>B</td><td>CLAN:MAIN_BUTTON_0</td><td>CONFIRM</td><td>확인</td><td></td></tr>'
      + '</tbody></table>';
    const metadata = createL10nSyncMetadata(frames);
    const current = structuredClone(frames[0]);
    current.strings = [
      {
        ...current.strings[0],
        targetNodeId: 'target:new',
        locator: 'target:new',
        korean: '새 타겟',
      },
      {
        ...current.strings[1],
        targetNodeId: 'target:A',
        locator: 'target:A',
        korean: '외형 챌린지',
      },
    ];

    const result = applyFigmaSourceUpdates(storage, [current], metadata);
    const table = findL10nTable(result.storage)!;
    const byTarget = new Map(result.metadata.rows.map((item, index) => [
      item.targetNodeId,
      table.rows[index],
    ]));

    expect(byTarget.get('target:A')).toMatchObject({
      delimiter: 'B',
      korean: '외형 챌린지',
      english: 'APPEARANCE',
      stringId: 'CLAN:MAIN_TITLE_0',
    });
    expect(byTarget.get('target:B')).toMatchObject({
      delimiter: '',
      korean: '확인',
      english: 'CONFIRM',
      stringId: 'CLAN:MAIN_BUTTON_0',
    });
    expect(byTarget.get('target:new')).toMatchObject({
      delimiter: 'A',
      korean: '새 타겟',
      english: '',
      stringId: '',
    });
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'FIGMA_TAG_MISSING',
        korean: '확인',
      }),
    ]));

    const restored = applyFigmaSourceUpdates(result.storage, frames, result.metadata);
    const restoredTable = findL10nTable(restored.storage)!;
    const restoredTargetBIndex = restored.metadata.rows.findIndex((item) =>
      item.targetNodeId === 'target:B');
    expect(restoredTable.rows[restoredTargetBIndex]).toMatchObject({
      delimiter: 'B',
      english: 'CONFIRM',
      stringId: 'CLAN:MAIN_BUTTON_0',
    });
  });

  it('merges a legacy duplicate into the current tagged row in the same frame', () => {
    const current = structuredClone(frames[0]);
    current.strings[1] = {
      ...current.strings[1],
      delimiter: 'E',
      tagNodeId: 'tag:E',
      targetNodeId: 'target:close',
      locator: 'target:close',
      korean: '닫기',
    };
    const currentMetadata = createL10nSyncMetadata([current]);
    const metadata = {
      ...currentMetadata,
      rows: [
        {
          fileKey: '',
          frameId: 'legacy-0',
          targetNodeId: '',
          tagNodeId: '',
          delimiter: 'G',
        },
        ...currentMetadata.rows,
      ],
    };
    const storage = '<table><tbody>'
      + '<tr><th>이미지</th><th>구분자</th><th>String ID</th><th>영문</th><th>국문</th><th>비고</th></tr>'
      + '<tr><td><ac:image><ri:attachment ri:filename="frame.png"/></ac:image></td><td></td><td>COMMON:CLOSE_BUTTON</td><td>CLOSE</td><td>닫기</td><td>기존 String ID 사용</td></tr>'
      + '<tr><td rowspan="2"><ac:image><ri:attachment ri:filename="frame.png"/></ac:image></td><td>A</td><td></td><td></td><td>외형 챌린지</td><td></td></tr>'
      + '<tr><td>E</td><td></td><td></td><td>닫기</td><td></td></tr>'
      + '</tbody></table>';

    const result = applyFigmaSourceUpdates(storage, [current], metadata);
    const table = findL10nTable(result.storage)!;
    const rowsByTarget = new Map(result.metadata.rows.map((item, index) => [
      item.targetNodeId,
      table.rows[index],
    ]));

    expect(table.rows).toHaveLength(2);
    expect(result.storage.match(/ri:filename="frame\.png"/g)).toHaveLength(1);
    expect(rowsByTarget.get('target:A')).toMatchObject({
      delimiter: 'A',
      korean: '외형 챌린지',
    });
    expect(rowsByTarget.get('target:close')).toMatchObject({
      delimiter: 'E',
      korean: '닫기',
      english: 'CLOSE',
      stringId: 'COMMON:CLOSE_BUTTON',
      note: '기존 String ID 사용',
    });
    expect(result.issues).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'FIGMA_TAG_MISSING', korean: '닫기' }),
    ]));
  });

  it('reports metadata misalignment instead of silently trusting shifted row positions', () => {
    const storage = createL10nTable('', frames);
    const metadata = createL10nSyncMetadata(frames);
    metadata.rows.pop();

    const result = applyFigmaSourceUpdates(storage, frames, metadata);

    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'WIKI_METADATA_MISMATCH' }),
    ]));
  });
});

describe('compareWikiRows', () => {
  it('keeps matched rows and reports each missing or mismatched row independently', () => {
    const storage = '<table><tbody>'
      + '<tr><th>구분자</th><th>이미지</th><th>국문</th><th>영문</th><th>String ID</th></tr>'
      + '<tr><td>A</td><td rowspan="3"><ac:image><ri:attachment ri:filename="frame.png"/></ac:image></td><td>외형 챌린지</td><td>Appearance Challenge</td><td></td></tr>'
      + '<tr><td>B</td><td>취소</td><td>Cancel</td><td></td></tr>'
      + '<tr><td>C</td><td>위키 전용</td><td>Wiki only</td><td></td></tr>'
      + '</tbody></table>';
    const comparedFrames = structuredClone(frames);
    comparedFrames[0].strings.push({
      ...comparedFrames[0].strings[1],
      delimiter: 'D',
      tagNodeId: 'tag:D',
      targetNodeId: 'target:D',
      korean: '피그마 전용',
    });

    const result = compareWikiRows(findL10nTable(storage)!, comparedFrames);

    expect(result.matched).toEqual([
      expect.objectContaining({ rowKey: '0:A:0', english: 'Appearance Challenge' }),
    ]);
    expect(result.issues.map((issue) => issue.code).sort()).toEqual([
      'FIGMA_TAG_MISSING',
      'KOREAN_MISMATCH',
      'WIKI_ROW_MISSING',
    ]);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'FIGMA_TAG_MISSING',
        delimiter: 'C',
        korean: '위키 전용',
      }),
      expect.objectContaining({
        code: 'KOREAN_MISMATCH',
        delimiter: 'B',
        frameName: '메인_외형 챌린지 선택',
        korean: '취소',
      }),
      expect.objectContaining({
        code: 'WIKI_ROW_MISSING',
        delimiter: 'D',
        frameName: '메인_외형 챌린지 선택',
        korean: '피그마 전용',
      }),
    ]));
  });
});
