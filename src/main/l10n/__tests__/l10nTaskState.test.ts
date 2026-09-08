import { describe, expect, it } from 'vitest';
import { L10nDraft, L10nInput, L10nTaskState } from '../../../shared/l10nTypes';
import {
  areL10nInputsEqual,
  prepareL10nTaskStateForInput,
  restoreL10nTaskState,
} from '../l10nTaskState';

const input: L10nInput = {
  wikiUrl: 'https://example.atlassian.net/wiki/spaces/P/pages/123/Test',
  figmaUrls: ['https://www.figma.com/design/file-key/Test?node-id=1-2'],
  featurePrefix: 'CLAN',
  releaseDate: '2026-12-03',
  releaseDateSource: 'auto',
};

const draft: L10nDraft = {
  wikiUrl: input.wikiUrl,
  figmaText: input.figmaUrls[0],
  featurePrefix: input.featurePrefix,
  releaseDate: input.releaseDate,
  releaseDateSource: input.releaseDateSource,
  taskTitle: '[v2612-10] 외형 챌린지',
};

const reviewState: L10nTaskState = {
  stage: 'wiki-review',
  label: 'STRING ID 검토 중',
  taskTitle: '[v2612-10] 외형 챌린지',
  activeInput: input,
  attentionCount: 1,
  issues: [{ code: 'ENGLISH_MISSING', message: '영문을 확인해 주세요.' }],
  stats: { total: 4, matched: 3, reused: 1, created: 2, common: 0, renumbered: 0, skipped: 1 },
  lastGeneratedAt: '2026-09-04T01:00:00.000Z',
  canGenerate: true,
  canFinalize: true,
  canCancel: true,
};

describe('restoreL10nTaskState', () => {
  it('restores a persisted review task with its input and result details', () => {
    expect(restoreL10nTaskState(reviewState, draft)).toEqual(reviewState);
  });

  it('turns a processing state interrupted by app shutdown into a retryable failure', () => {
    expect(restoreL10nTaskState({
      ...reviewState,
      stage: 'id-generating',
      label: 'STRING ID 생성 중',
      canGenerate: false,
      canFinalize: false,
    }, draft)).toEqual(expect.objectContaining({
      stage: 'error',
      label: '작업 실패',
      taskTitle: reviewState.taskTitle,
      activeInput: input,
      error: '앱 종료로 작업이 중단되었습니다. 다시 실행해 주세요.',
      canGenerate: true,
      canFinalize: false,
      canCancel: true,
    }));
  });

  it('marks a legacy titled draft as a retryable task when no state was persisted', () => {
    expect(restoreL10nTaskState(undefined, draft)).toEqual(expect.objectContaining({
      stage: 'error',
      label: '작업 실패',
      taskTitle: draft.taskTitle,
      activeInput: input,
      error: '이전 작업 상태를 복원할 수 없습니다. 다시 실행해 주세요.',
      canGenerate: true,
      canFinalize: false,
      canCancel: true,
    }));
  });
});

describe('active task input', () => {
  it('ignores formatting-only differences when comparing task inputs', () => {
    expect(areL10nInputsEqual(input, {
      ...input,
      wikiUrl: ` ${input.wikiUrl} `,
      figmaUrls: [` ${input.figmaUrls[0]} `],
      featurePrefix: 'clan',
      releaseDateSource: 'manual',
    })).toBe(true);
  });

  it('clears the previous task result only when execution starts with different inputs', () => {
    expect(prepareL10nTaskStateForInput(reviewState, input)).toEqual(reviewState);

    const replaced = prepareL10nTaskStateForInput(reviewState, {
      ...input,
      wikiUrl: 'https://example.atlassian.net/wiki/spaces/P/pages/456/New',
    });
    expect(replaced).toEqual(expect.objectContaining({
      stage: 'idle',
      attentionCount: 0,
      activeInput: expect.objectContaining({
        wikiUrl: 'https://example.atlassian.net/wiki/spaces/P/pages/456/New',
      }),
    }));
    expect(replaced.taskTitle).toBeUndefined();
  });
});
