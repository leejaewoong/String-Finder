import {
  L10nDraft,
  L10nInput,
  L10nIssue,
  L10nStage,
  L10nStats,
  L10nTaskState,
} from '../../shared/l10nTypes';
import {
  areL10nInputsEqual,
  cloneL10nInput,
  l10nInputFromDraft,
} from '../../shared/l10nSession';

export { areL10nInputsEqual } from '../../shared/l10nSession';

const INTERRUPTED_MESSAGE = '앱 종료로 작업이 중단되었습니다. 다시 실행해 주세요.';
const LEGACY_MESSAGE = '이전 작업 상태를 복원할 수 없습니다. 다시 실행해 주세요.';
const STAGES = new Set<L10nStage>([
  'idle',
  'input',
  'figma-scanning',
  'table-creating',
  'english-review',
  'id-generating',
  'wiki-review',
  'json-applying',
  'complete',
  'error',
]);
const INTERRUPTED_STAGES = new Set<L10nStage>([
  'figma-scanning',
  'table-creating',
  'id-generating',
  'json-applying',
]);

const EMPTY_STATS: L10nStats = {
  total: 0,
  matched: 0,
  reused: 0,
  created: 0,
  common: 0,
  renumbered: 0,
  skipped: 0,
};

export function emptyL10nTaskState(): L10nTaskState {
  return {
    stage: 'idle',
    label: '',
    attentionCount: 0,
    issues: [],
    stats: { ...EMPTY_STATS },
    canGenerate: true,
    canFinalize: false,
    canCancel: false,
  };
}

function inputFromUnknown(value: unknown): L10nInput | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Partial<ReturnType<typeof l10nInputFromDraft>>;
  if (typeof input.wikiUrl !== 'string'
    || !Array.isArray(input.figmaUrls)
    || !input.figmaUrls.every((url) => typeof url === 'string')
    || typeof input.featurePrefix !== 'string'
    || typeof input.releaseDate !== 'string'
    || input.releaseDateSource !== 'auto' && input.releaseDateSource !== 'manual') {
    return undefined;
  }
  return cloneL10nInput(input as L10nInput);
}

function legacyState(draft: L10nDraft): L10nTaskState {
  if (!draft.taskTitle?.trim()) return emptyL10nTaskState();
  return {
    ...emptyL10nTaskState(),
    stage: 'error',
    label: '작업 실패',
    taskTitle: draft.taskTitle,
    activeInput: l10nInputFromDraft(draft),
    error: LEGACY_MESSAGE,
    canCancel: true,
  };
}

export function restoreL10nTaskState(value: unknown, draft: L10nDraft): L10nTaskState {
  if (!value || typeof value !== 'object') return legacyState(draft);
  const candidate = value as Partial<L10nTaskState>;
  if (!candidate.stage || !STAGES.has(candidate.stage) || candidate.stage === 'idle') {
    return legacyState(draft);
  }

  const activeInput = inputFromUnknown(candidate.activeInput);
  const state: L10nTaskState = {
    stage: candidate.stage,
    label: typeof candidate.label === 'string' ? candidate.label : '',
    ...(typeof candidate.taskTitle === 'string' && candidate.taskTitle.trim()
      ? { taskTitle: candidate.taskTitle }
      : {}),
    ...(activeInput ? { activeInput } : {}),
    attentionCount: typeof candidate.attentionCount === 'number' ? candidate.attentionCount : 0,
    issues: Array.isArray(candidate.issues)
      ? candidate.issues.filter((issue): issue is L10nIssue => Boolean(issue && typeof issue === 'object'))
      : [],
    stats: candidate.stats && typeof candidate.stats === 'object'
      ? { ...EMPTY_STATS, ...candidate.stats }
      : { ...EMPTY_STATS },
    ...(typeof candidate.lastGeneratedAt === 'string'
      ? { lastGeneratedAt: candidate.lastGeneratedAt }
      : {}),
    ...(typeof candidate.error === 'string' ? { error: candidate.error } : {}),
    canGenerate: Boolean(candidate.canGenerate),
    canFinalize: Boolean(candidate.canFinalize),
    canCancel: Boolean(candidate.canCancel),
  };

  if (!state.activeInput) state.activeInput = l10nInputFromDraft(draft);
  if (!INTERRUPTED_STAGES.has(state.stage)) return state;

  return {
    ...state,
    stage: 'error',
    label: '작업 실패',
    error: INTERRUPTED_MESSAGE,
    canGenerate: true,
    canFinalize: false,
    canCancel: true,
  };
}

export function prepareL10nTaskStateForInput(
  state: L10nTaskState,
  input: L10nInput,
): L10nTaskState {
  if (areL10nInputsEqual(state.activeInput, input)) return state;
  return {
    ...emptyL10nTaskState(),
    activeInput: cloneL10nInput(input),
  };
}
