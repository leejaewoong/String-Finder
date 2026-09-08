import { describe, expect, it } from 'vitest';
import { emptyL10nDraft, normalizeL10nDraft } from '../l10nDraft';

describe('normalizeL10nDraft', () => {
  it('restores every persisted input and task title', () => {
    expect(normalizeL10nDraft({
      wikiUrl: ' https://example.atlassian.net/wiki/123 ',
      figmaText: 'https://figma.com/design/file/page',
      featurePrefix: ' clan ',
      releaseDate: '2026-12-03',
      releaseDateSource: 'manual',
      taskTitle: '[v2612] 외형 챌린지',
    })).toEqual({
      wikiUrl: ' https://example.atlassian.net/wiki/123 ',
      figmaText: 'https://figma.com/design/file/page',
      featurePrefix: 'CLAN',
      releaseDate: '2026-12-03',
      releaseDateSource: 'manual',
      taskTitle: '[v2612] 외형 챌린지',
    });
  });

  it('replaces malformed persisted data with a safe empty draft', () => {
    expect(normalizeL10nDraft({
      wikiUrl: 123,
      figmaText: null,
      featurePrefix: '잘못된 prefix',
      releaseDate: 'tomorrow',
      releaseDateSource: 'unknown',
      taskTitle: [],
    })).toEqual(emptyL10nDraft());
  });
});
