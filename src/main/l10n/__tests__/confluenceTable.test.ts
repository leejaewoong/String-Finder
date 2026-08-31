import { describe, expect, it } from 'vitest';
import { FigmaScannedFrame } from '../figmaClient';
import {
  applyStringIdUpdates,
  compareWikiRows,
  createL10nTable,
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
    expect(result).toContain('<th>구분자</th><th>이미지</th><th>국문</th><th>영문</th><th>String ID</th>');
    expect(result).toContain('rowspan="2"');
    expect(result).toContain('ri:filename="frame.png"');
    expect(result).toContain('<td>외형 챌린지</td>');
    expect(result).toContain('<td>확인</td>');
  });
});

describe('applyStringIdUpdates', () => {
  it('adds only the String ID column and updates matching rows', () => {
    const storage = '<p>본문</p><table><tbody>'
      + '<tr><th>구분자</th><th>국문</th><th>영문</th></tr>'
      + '<tr><td>A</td><td>외형 챌린지</td><td>Appearance Challenge</td></tr>'
      + '</tbody></table>';

    const result = applyStringIdUpdates(storage, [{ rowKey: '0:A:0', stringId: 'EOM:MAIN_TITLE_0' }]);

    expect(result).toContain('<th>String ID</th>');
    expect(result).toContain('<td>EOM:MAIN_TITLE_0</td>');
    expect(result).toContain('<p>본문</p>');
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
  });
});
