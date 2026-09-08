import { L10nDraft, L10nInput } from './l10nTypes';

function normalizedFigmaUrls(urls: string[]): string[] {
  return urls.map((url) => url.trim()).filter(Boolean).sort();
}

export function cloneL10nInput(input: L10nInput): L10nInput {
  return {
    wikiUrl: input.wikiUrl.trim(),
    figmaUrls: normalizedFigmaUrls(input.figmaUrls),
    featurePrefix: input.featurePrefix.trim().toUpperCase(),
    releaseDate: input.releaseDate.trim(),
    releaseDateSource: input.releaseDateSource,
  };
}

export function l10nInputFromDraft(draft: L10nDraft): L10nInput {
  return cloneL10nInput({
    wikiUrl: draft.wikiUrl,
    figmaUrls: draft.figmaText.split(/\r?\n/),
    featurePrefix: draft.featurePrefix,
    releaseDate: draft.releaseDate,
    releaseDateSource: draft.releaseDateSource,
  });
}

export function areL10nInputsEqual(
  left: L10nInput | undefined,
  right: L10nInput | undefined,
): boolean {
  if (!left || !right) return false;
  const normalizedLeft = cloneL10nInput(left);
  const normalizedRight = cloneL10nInput(right);
  return normalizedLeft.wikiUrl === normalizedRight.wikiUrl
    && normalizedLeft.featurePrefix === normalizedRight.featurePrefix
    && normalizedLeft.releaseDate === normalizedRight.releaseDate
    && normalizedLeft.figmaUrls.length === normalizedRight.figmaUrls.length
    && normalizedLeft.figmaUrls.every((url, index) => url === normalizedRight.figmaUrls[index]);
}
