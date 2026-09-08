import { describe, expect, it } from 'vitest';
import { L10nStage, L10nTaskState } from '../../../shared/l10nTypes';
import {
  getL10nActionAvailability,
  getFeatureMenuMaxHeight,
  getL10nTaskTitle,
  getL10nTabStatus,
  isL10nBusy,
  shouldSuggestReleaseDate,
} from '../../../renderer/l10nPresentation';
import * as l10nPresentation from '../../../renderer/l10nPresentation';

describe('getFeatureMenuMaxHeight', () => {
  it('keeps the downward menu inside the app viewport', () => {
    expect(getFeatureMenuMaxHeight(720, 450)).toBe(258);
    expect(getFeatureMenuMaxHeight(1200, 400)).toBe(280);
    expect(getFeatureMenuMaxHeight(480, 450)).toBe(18);
  });
});

const baseState: L10nTaskState = {
  stage: 'idle',
  label: '',
  attentionCount: 0,
  issues: [],
  stats: { total: 0, matched: 0, reused: 0, created: 0, common: 0, renumbered: 0, skipped: 0 },
  canGenerate: true,
  canFinalize: false,
  canCancel: false,
};

describe('getL10nTabStatus', () => {
  it.each<[L10nStage, string, string]>([
    ['idle', '', ''],
    ['input', '', ''],
    ['figma-scanning', 'STRING ID 생성 중', 'STRING ID 생성 중'],
    ['figma-scanning', 'JSON 반영 중', 'JSON 반영 중'],
    ['table-creating', '', '위키 작성 중'],
    ['english-review', '', '영문 검수 대기중'],
    ['id-generating', '', 'STRING ID 생성 중'],
    ['wiki-review', '', 'STRING ID 검토 중'],
    ['json-applying', '', 'JSON 반영 중'],
    ['complete', '', '작업 완료'],
    ['error', '', '작업 실패'],
  ])('%s 단계는 허용된 상태 문구만 표시한다', (stage, label, expected) => {
    expect(getL10nTabStatus({ ...baseState, stage, label })).toBe(expected);
  });
});

describe('isL10nBusy', () => {
  it('shows progress only while remote work or JSON writing is active', () => {
    expect(['figma-scanning', 'table-creating', 'id-generating', 'json-applying'].filter(
      (stage) => isL10nBusy(stage as L10nStage),
    )).toEqual(['figma-scanning', 'table-creating', 'id-generating', 'json-applying']);
    expect(isL10nBusy('english-review')).toBe(false);
    expect(isL10nBusy('wiki-review')).toBe(false);
    expect(isL10nBusy('complete')).toBe(false);
  });
});

describe('getL10nActionAvailability', () => {
  const activeInput = {
    wikiUrl: 'https://example.atlassian.net/wiki/spaces/P/pages/123/Test',
    figmaUrls: ['https://www.figma.com/design/file-key/Test?node-id=1-2'],
    featurePrefix: 'CLAN',
    releaseDate: '2026-12-03',
    releaseDateSource: 'auto' as const,
  };
  const activeDraft = {
    wikiUrl: activeInput.wikiUrl,
    figmaText: activeInput.figmaUrls[0],
    featurePrefix: activeInput.featurePrefix,
    releaseDate: activeInput.releaseDate,
    releaseDateSource: activeInput.releaseDateSource,
  };

  it('keeps JSON application available only for the input that produced the review state', () => {
    expect(getL10nActionAvailability({
      ...baseState,
      stage: 'wiki-review',
      canFinalize: true,
      activeInput,
    }, activeDraft)).toEqual({ canGenerate: true, canFinalize: true });

    expect(getL10nActionAvailability({
      ...baseState,
      stage: 'wiki-review',
      canFinalize: true,
      activeInput,
    }, { ...activeDraft, featurePrefix: 'SHOP' })).toEqual({
      canGenerate: true,
      canFinalize: false,
    });
  });

  it('allows a completed task to be replaced by explicitly running different inputs', () => {
    expect(getL10nActionAvailability({
      ...baseState,
      stage: 'complete',
      canGenerate: false,
      activeInput,
    }, { ...activeDraft, wikiUrl: 'https://example.atlassian.net/wiki/spaces/P/pages/456/New' }))
      .toEqual({ canGenerate: true, canFinalize: false });
  });
});

describe('getL10nTaskTitle', () => {
  it('does not show the previous draft title after a different task starts', () => {
    expect(getL10nTaskTitle({
      ...baseState,
      stage: 'figma-scanning',
      activeInput: {
        wikiUrl: 'https://example.atlassian.net/wiki/spaces/P/pages/456/New',
        figmaUrls: ['https://www.figma.com/design/new-file/New?node-id=1-2'],
        featurePrefix: 'SHOP',
        releaseDate: '2026-12-03',
        releaseDateSource: 'auto',
      },
    }, {
      wikiUrl: 'https://example.atlassian.net/wiki/spaces/P/pages/456/New',
      figmaText: 'https://www.figma.com/design/new-file/New?node-id=1-2',
      featurePrefix: 'SHOP',
      releaseDate: '2026-12-03',
      releaseDateSource: 'auto',
      taskTitle: '[v2612-10] 이전 작업',
    })).toBe('새 String ID 작업');
  });
});

describe('shouldSuggestReleaseDate', () => {
  const wikiUrl = 'https://krafton.atlassian.net/wiki/spaces/PUBGPC/pages/123/UPDATE';

  it('suggests immediately for a complete URL when a manual date is empty', () => {
    expect(shouldSuggestReleaseDate({
      wikiUrl,
      releaseDate: '',
      releaseDateSource: 'manual',
    }, [], true)).toBe(true);
  });

  it('preserves a non-empty manual date', () => {
    expect(shouldSuggestReleaseDate({
      wikiUrl,
      releaseDate: '2026-12-03',
      releaseDateSource: 'manual',
    }, [], true)).toBe(false);
  });

  it('requires configuration and at least one complete wiki or Figma URL', () => {
    const draft = { wikiUrl: 'https://krafton.atlassian.net/wiki/', releaseDate: '', releaseDateSource: 'auto' as const };
    expect(shouldSuggestReleaseDate(draft, [], true)).toBe(false);
    expect(shouldSuggestReleaseDate(draft, [
      'https://www.figma.com/design/file-key/v2612?node-id=1-2',
    ], true)).toBe(true);
    expect(shouldSuggestReleaseDate({ ...draft, wikiUrl }, [], false)).toBe(false);
  });
});

describe('getL10nIssueGroups', () => {
  it('groups repeated delimiters by frame and adds readable issue labels', () => {
    const getL10nIssueGroups = (l10nPresentation as typeof l10nPresentation & {
      getL10nIssueGroups?: (issues: unknown[], mode?: 'frame' | 'status') => unknown;
    }).getL10nIssueGroups;

    expect(getL10nIssueGroups?.([
      {
        code: 'FIGMA_TAG_MISSING',
        message: 'Figma 태그가 없습니다.',
        delimiter: 'G',
        korean: '장착',
      },
      {
        code: 'WIKI_ROW_MISSING',
        message: '위키 행이 없습니다.',
        delimiter: 'G',
        korean: '장착 해제',
        frameName: '메인_외형 챌린지 선택',
      },
      {
        code: 'ENGLISH_MISSING',
        message: '영문이 비어 있습니다.',
        delimiter: 'E',
        korean: '돌려보기',
        frameName: '마스터 B_최종 12',
      },
    ])).toEqual([
      {
        key: 'frame:기타',
        title: '기타',
        issues: [expect.objectContaining({
          label: 'Figma 태그 누락',
          delimiter: 'G',
          korean: '장착',
        })],
      },
      {
        key: 'frame:메인_외형 챌린지 선택',
        title: '메인_외형 챌린지 선택',
        issues: [expect.objectContaining({
          label: '위키 행 누락',
          delimiter: 'G',
          korean: '장착 해제',
        })],
      },
      {
        key: 'frame:마스터 B_최종 12',
        title: '마스터 B_최종 12',
        issues: [expect.objectContaining({
          label: '영문 누락',
          delimiter: 'E',
          korean: '돌려보기',
        })],
      },
    ]);
  });

  it('adds source references only when frame, delimiter, and Korean are duplicated', () => {
    const getL10nIssueGroups = (l10nPresentation as typeof l10nPresentation & {
      getL10nIssueGroups?: (issues: unknown[], mode?: 'frame' | 'status') => unknown;
    }).getL10nIssueGroups;

    expect(getL10nIssueGroups?.([
      {
        code: 'FIGMA_TAG_MISSING',
        message: 'Figma 태그가 없습니다.',
        rowKey: '0:G:4',
        delimiter: 'G',
        korean: '장착',
      },
      {
        code: 'FIGMA_TAG_MISSING',
        message: 'Figma 태그가 없습니다.',
        rowKey: '0:G:8',
        delimiter: 'G',
        korean: '장착',
      },
      {
        code: 'WIKI_ROW_MISSING',
        message: '위키 행이 없습니다.',
        rowKey: 'tag:1',
        delimiter: 'G',
        korean: '장착',
        frameName: '메인',
      },
      {
        code: 'WIKI_ROW_MISSING',
        message: '위키 행이 없습니다.',
        rowKey: 'tag:2',
        delimiter: 'G',
        korean: '장착',
        frameName: '메인',
      },
    ])).toEqual([
      {
        key: 'frame:기타',
        title: '기타',
        issues: [
          expect.objectContaining({ reference: '위키 5번째 항목' }),
          expect.objectContaining({ reference: '위키 9번째 항목' }),
        ],
      },
      {
        key: 'frame:메인',
        title: '메인',
        issues: [
          expect.objectContaining({ reference: 'Figma 노드 tag:1' }),
          expect.objectContaining({ reference: 'Figma 노드 tag:2' }),
        ],
      },
    ]);
  });

  it('groups issues by error status while preserving their frame locations', () => {
    const getL10nIssueGroups = (l10nPresentation as typeof l10nPresentation & {
      getL10nIssueGroups?: (issues: unknown[], mode?: 'frame' | 'status') => unknown;
    }).getL10nIssueGroups;

    expect(getL10nIssueGroups?.([
      {
        code: 'ENGLISH_MISSING',
        message: '영문이 비어 있습니다.',
        delimiter: 'A',
        korean: '외형 챌린지',
        frameName: '메인',
      },
      {
        code: 'FIGMA_TAG_MISSING',
        message: 'Figma 태그가 없습니다.',
        delimiter: 'B',
        korean: '확인',
        frameName: '팝업',
      },
      {
        code: 'ENGLISH_MISSING',
        message: '영문이 비어 있습니다.',
        delimiter: 'C',
        korean: '닫기',
        frameName: '팝업',
      },
    ], 'status')).toEqual([
      {
        key: 'status:ENGLISH_MISSING',
        title: '영문 누락',
        issues: [
          expect.objectContaining({ frameName: '메인', delimiter: 'A', korean: '외형 챌린지' }),
          expect.objectContaining({ frameName: '팝업', delimiter: 'C', korean: '닫기' }),
        ],
      },
      {
        key: 'status:FIGMA_TAG_MISSING',
        title: 'Figma 태그 누락',
        issues: [
          expect.objectContaining({ frameName: '팝업', delimiter: 'B', korean: '확인' }),
        ],
      },
    ]);
  });
});
