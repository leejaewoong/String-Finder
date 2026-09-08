import { L10nDraft } from '../../shared/l10nTypes';

export function emptyL10nDraft(): L10nDraft {
  return {
    wikiUrl: '',
    figmaText: '',
    featurePrefix: '',
    releaseDate: '',
    releaseDateSource: 'auto',
  };
}

export function normalizeL10nDraft(value: unknown): L10nDraft {
  if (!value || typeof value !== 'object') return emptyL10nDraft();
  const draft = value as Partial<L10nDraft>;
  const releaseDate = typeof draft.releaseDate === 'string'
    && /^20\d{2}-\d{2}-\d{2}$/.test(draft.releaseDate)
    ? draft.releaseDate
    : '';
  const releaseDateSource = draft.releaseDateSource === 'manual' ? 'manual' : 'auto';
  const taskTitle = typeof draft.taskTitle === 'string' && draft.taskTitle.trim()
    ? draft.taskTitle
    : undefined;
  const featurePrefixCandidate = typeof draft.featurePrefix === 'string'
    ? draft.featurePrefix.trim().toUpperCase()
    : '';
  const featurePrefix = /^[A-Z0-9_]*$/.test(featurePrefixCandidate)
    ? featurePrefixCandidate
    : '';

  return {
    wikiUrl: typeof draft.wikiUrl === 'string' ? draft.wikiUrl : '',
    figmaText: typeof draft.figmaText === 'string' ? draft.figmaText : '',
    featurePrefix,
    releaseDate,
    releaseDateSource,
    ...(taskTitle ? { taskTitle } : {}),
  };
}
