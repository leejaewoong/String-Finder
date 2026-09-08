import {
  L10nDraft,
  L10nIssue,
  L10nIssueCode,
  L10nStage,
  L10nTaskState,
} from '../shared/l10nTypes';
import { areL10nInputsEqual, l10nInputFromDraft } from '../shared/l10nSession';

const ISSUE_LABELS: Record<L10nIssueCode, string> = {
  WIKI_ROW_MISSING: '위키 행 누락',
  WIKI_METADATA_MISMATCH: '위키 연결 정보 확인 필요',
  FIGMA_TAG_MISSING: 'Figma 태그 누락',
  KOREAN_MISMATCH: '국문 불일치',
  FIGMA_TAG_INVALID: 'Figma 태그 오류',
  FIGMA_TARGET_MISSING: 'Figma 타겟 누락',
  FIGMA_TARGET_DUPLICATE: '중복 타게팅',
  ENGLISH_MISSING: '영문 누락',
  STRING_ID_INVALID: 'String ID 오류',
  STRING_ID_COLLISION: 'String ID 충돌',
  STRING_ID_TYPE_MISMATCH: 'Type 확인 필요',
  TARGET_FILE_MISSING: 'JSON 파일 누락',
  LLM_INFERENCE_FAILED: '분류 실패',
};

export interface L10nPresentedIssue extends L10nIssue {
  label: string;
  reference?: string;
}

export type L10nIssueGroupMode = 'frame' | 'status';

export interface L10nIssueGroup {
  key: string;
  title: string;
  issues: L10nPresentedIssue[];
}

export function getL10nIssueGroups(
  issues: L10nIssue[],
  mode: L10nIssueGroupMode = 'frame',
): L10nIssueGroup[] {
  const locatorCounts = new Map<string, number>();
  issues.forEach((issue) => {
    const frameName = issue.frameName?.trim() || '기타';
    const locatorKey = `${frameName}\u0000${issue.delimiter ?? ''}\u0000${issue.korean ?? ''}`;
    locatorCounts.set(locatorKey, (locatorCounts.get(locatorKey) ?? 0) + 1);
  });

  const groups = new Map<string, L10nIssueGroup>();
  issues.forEach((issue) => {
    const frameName = issue.frameName?.trim() || '기타';
    const label = ISSUE_LABELS[issue.code];
    const key = mode === 'status' ? `status:${issue.code}` : `frame:${frameName}`;
    const title = mode === 'status' ? label : frameName;
    const locatorKey = `${frameName}\u0000${issue.delimiter ?? ''}\u0000${issue.korean ?? ''}`;
    const wikiRow = issue.rowKey?.match(/^\d+:[^:]*:(\d+)$/);
    const reference = wikiRow
      ? `위키 ${Number.parseInt(wikiRow[1], 10) + 1}번째 항목`
      : issue.rowKey
        ? `Figma 노드 ${issue.rowKey}`
        : undefined;
    const presentedIssue: L10nPresentedIssue = {
      ...issue,
      label,
      ...((locatorCounts.get(locatorKey) ?? 0) > 1 && reference ? { reference } : {}),
    };
    const group = groups.get(key) ?? { key, title, issues: [] };
    group.issues.push(presentedIssue);
    groups.set(key, group);
  });

  return [...groups.values()];
}

type ReleaseDateDraft = Pick<
  L10nDraft,
  'wikiUrl' | 'releaseDate' | 'releaseDateSource'
>;

export function getFeatureMenuMaxHeight(
  viewportHeight: number,
  inputBottom: number,
): number {
  return Math.max(0, Math.min(280, viewportHeight - inputBottom - 12));
}

function matchesUrl(value: string, predicate: (url: URL) => boolean): boolean {
  try {
    return predicate(new URL(value.trim()));
  } catch {
    return false;
  }
}

function isCompleteWikiUrl(value: string): boolean {
  return matchesUrl(value, (url) =>
    /(^|\.)atlassian\.net$/i.test(url.hostname)
    && /\/wiki\/.+\/pages\/\d+/i.test(url.pathname)
  );
}

function isCompleteFigmaUrl(value: string): boolean {
  return matchesUrl(value, (url) =>
    /(^|\.)figma\.com$/i.test(url.hostname)
    && /^\/(?:design|file)\/[^/]+/i.test(url.pathname)
  );
}

export function shouldSuggestReleaseDate(
  draft: ReleaseDateDraft,
  figmaUrls: string[],
  configured: boolean,
): boolean {
  if (!configured) return false;
  if (draft.releaseDateSource === 'manual' && draft.releaseDate.trim()) return false;
  return isCompleteWikiUrl(draft.wikiUrl) || figmaUrls.some(isCompleteFigmaUrl);
}

export function getL10nTabStatus(state: L10nTaskState): string {
  switch (state.stage) {
    case 'figma-scanning':
      return state.label === 'JSON 반영 중' ? 'JSON 반영 중' : 'STRING ID 생성 중';
    case 'table-creating':
      return '위키 작성 중';
    case 'english-review':
      return '영문 검수 대기중';
    case 'id-generating':
      return 'STRING ID 생성 중';
    case 'wiki-review':
      return 'STRING ID 검토 중';
    case 'json-applying':
      return 'JSON 반영 중';
    case 'complete':
      return '작업 완료';
    case 'error':
      return '작업 실패';
    default:
      return '';
  }
}

export function isL10nBusy(stage: L10nStage): boolean {
  return stage === 'figma-scanning'
    || stage === 'table-creating'
    || stage === 'id-generating'
    || stage === 'json-applying';
}

export function getL10nActionAvailability(
  state: L10nTaskState,
  draft: L10nDraft,
): { canGenerate: boolean; canFinalize: boolean } {
  const matchesActiveTask = areL10nInputsEqual(
    state.activeInput,
    l10nInputFromDraft(draft),
  );
  const replacesActiveTask = Boolean(state.activeInput) && !matchesActiveTask;
  return {
    canGenerate: state.canGenerate || replacesActiveTask,
    canFinalize: state.canFinalize && matchesActiveTask,
  };
}

export function getL10nTaskTitle(state: L10nTaskState, draft: L10nDraft): string {
  return state.taskTitle
    || (state.stage === 'idle' ? draft.taskTitle : undefined)
    || '새 String ID 작업';
}
