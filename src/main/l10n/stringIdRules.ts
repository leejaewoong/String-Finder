import { InputFileData, L10nIssue } from '../../shared/l10nTypes';

export const STRING_ID_TYPES = [
  'ALL',
  'GNB',
  'LNB',
  'TITLE',
  'BODY',
  'BUTTON',
  'TOOLTIP',
  'FLOAT',
  'ICON',
  'MSG',
] as const;

export type StringIdType = typeof STRING_ID_TYPES[number];
export type StringIdAction = 'reuse' | 'create' | 'renumber' | 'skip';

export interface StringIdRow {
  rowKey: string;
  korean: string;
  english: string;
  stringId: string;
}

export interface StringIdInference {
  rowKey: string;
  feature: string;
  screen: string;
  type: StringIdType;
}

export interface ParsedStringId {
  feature: string;
  screen: string;
  type: StringIdType;
  number: number;
}

export interface ExistingStringRecord extends ParsedStringId {
  stringId: string;
  text: string;
  normalizedText: string;
  korean?: string;
  normalizedKorean?: string;
  releaseDate: string;
  fileName: string;
}

export interface StringIndex {
  records: ExistingStringRecord[];
  byId: Map<string, ExistingStringRecord>;
  byTextType: Map<string, ExistingStringRecord[]>;
  byKoreanType: Map<string, ExistingStringRecord[]>;
}

export interface StringIdDecision {
  rowKey: string;
  korean: string;
  english: string;
  releaseDate: string;
  stringId: string;
  action: StringIdAction;
  targetFile?: string;
  reason?: string;
}

const TYPE_PATTERN = STRING_ID_TYPES.join('|');
const STRING_ID_PATTERN = new RegExp(
  `^([A-Z0-9_]+):([A-Z0-9_]+)_(${TYPE_PATTERN})_(\\d+)$`,
);
const LEGACY_REUSABLE_ID_PATTERN = new RegExp(
  `^(COMMON|XB):([A-Z0-9_]+)_(${TYPE_PATTERN})$`,
);
const REUSABLE_FEATURES = ['COMMON', 'XB'] as const;

export function normalizeStringText(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

export function parseStringId(value: string): ParsedStringId | undefined {
  const match = value.trim().match(STRING_ID_PATTERN);
  if (!match) return undefined;
  return {
    feature: match[1],
    screen: match[2],
    type: match[3] as StringIdType,
    number: Number.parseInt(match[4], 10),
  };
}

function parseIndexedStringId(value: string): ParsedStringId | undefined {
  const parsed = parseStringId(value);
  if (parsed) return parsed;

  const match = value.trim().match(LEGACY_REUSABLE_ID_PATTERN);
  if (!match) return undefined;
  return {
    feature: match[1],
    screen: match[2],
    type: match[3] as StringIdType,
    number: -1,
  };
}

function textTypeKey(text: string, type: StringIdType): string {
  return `${type}\u0000${normalizeStringText(text)}`;
}

function featureFileName(
  feature: string,
  targetFiles: ReadonlyMap<string, string>,
): string {
  if (feature === 'COMMON') return 'ui_common.json';
  return targetFiles.get(feature) ?? `ui_${feature.toLowerCase()}.json`;
}

function comparePreferredRecord(a: ExistingStringRecord, b: ExistingStringRecord): number {
  return b.releaseDate.localeCompare(a.releaseDate) || a.stringId.localeCompare(b.stringId);
}

function areTypesCompatible(a: StringIdType, b: StringIdType): boolean {
  return a === b || ((a === 'BODY' || a === 'FLOAT') && (b === 'BODY' || b === 'FLOAT'));
}

function findCompatibleMatches(
  recordsByTextType: ReadonlyMap<string, ExistingStringRecord[]>,
  text: string,
  type: StringIdType,
): ExistingStringRecord[] {
  return STRING_ID_TYPES
    .filter((candidate) => areTypesCompatible(type, candidate))
    .flatMap((candidate) => recordsByTextType.get(textTypeKey(text, candidate)) ?? [])
    .sort(comparePreferredRecord);
}

function findReusableMatch(matches: ExistingStringRecord[]): ExistingStringRecord | undefined {
  for (const feature of REUSABLE_FEATURES) {
    const match = matches.find((record) => record.feature === feature);
    if (match) return match;
  }
  return undefined;
}

function crossFeatureFiles(
  matches: ExistingStringRecord[],
  selectedTargetFile: string,
): Set<string> {
  const excludedFiles = new Set([
    'ui_common.json',
    'ui_dev.json',
    selectedTargetFile.toLowerCase(),
  ]);
  return new Set(matches
    .map((record) => record.fileName.toLowerCase())
    .filter((fileName) => !excludedFiles.has(fileName)));
}

export function buildStringIndex(
  files: Map<string, InputFileData>,
  koreanById: Map<string, string> = new Map(),
): StringIndex {
  const records: ExistingStringRecord[] = [];
  const byId = new Map<string, ExistingStringRecord>();
  const byTextType = new Map<string, ExistingStringRecord[]>();
  const byKoreanType = new Map<string, ExistingStringRecord[]>();

  for (const [fileName, data] of files) {
    for (const [stringId, value] of Object.entries(data)) {
      const parsed = parseIndexedStringId(stringId);
      if (!parsed) continue;
      const korean = koreanById.get(stringId);
      const record: ExistingStringRecord = {
        ...parsed,
        stringId,
        text: value.Text,
        normalizedText: normalizeStringText(value.Text),
        ...(korean ? {
          korean,
          normalizedKorean: normalizeStringText(korean),
        } : {}),
        releaseDate: value.ReleaseDate,
        fileName,
      };
      records.push(record);
      byId.set(stringId, record);
      const key = textTypeKey(record.text, record.type);
      const matches = byTextType.get(key) ?? [];
      matches.push(record);
      byTextType.set(key, matches);
      if (record.normalizedKorean) {
        const koreanKey = textTypeKey(record.normalizedKorean, record.type);
        const koreanMatches = byKoreanType.get(koreanKey) ?? [];
        koreanMatches.push(record);
        byKoreanType.set(koreanKey, koreanMatches);
      }
    }
  }

  for (const matches of byTextType.values()) {
    matches.sort(comparePreferredRecord);
  }
  for (const matches of byKoreanType.values()) {
    matches.sort(comparePreferredRecord);
  }
  return { records, byId, byTextType, byKoreanType };
}

function cleanSegment(value: string, fallback: string): string {
  const cleaned = value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

function buildId(feature: string, screen: string, type: StringIdType, number: number): string {
  return `${feature}:${screen}_${type}_${number}`;
}

export function decideStringIds(
  rows: StringIdRow[],
  inferences: StringIdInference[],
  index: StringIndex,
  releaseDate: string,
  targetFiles: ReadonlyMap<string, string> = new Map(),
  reservedRows: StringIdRow[] = [],
): StringIdDecision[] {
  const inferenceByRow = new Map(inferences.map((item) => [item.rowKey, item]));
  const occupied = new Map<string, { text: string; existing: boolean }>();
  index.records.forEach((record) => occupied.set(record.stringId, {
    text: record.normalizedText,
    existing: true,
  }));
  reservedRows.forEach((row) => {
    const stringId = row.stringId.trim();
    if (!stringId || occupied.has(stringId)) return;
    occupied.set(stringId, {
      text: normalizeStringText(row.english || row.korean),
      existing: false,
    });
  });

  const allocate = (
    feature: string,
    screen: string,
    type: StringIdType,
    text: string,
  ): string => {
    let max = -1;
    for (const stringId of occupied.keys()) {
      const parsed = parseStringId(stringId);
      if (parsed
        && parsed.feature === feature
        && parsed.screen === screen
        && parsed.type === type) {
        max = Math.max(max, parsed.number);
      }
    }
    const stringId = buildId(feature, screen, type, max + 1);
    occupied.set(stringId, { text, existing: false });
    return stringId;
  };

  return rows.map((row): StringIdDecision => {
    const english = normalizeStringText(row.english);
    const korean = normalizeStringText(row.korean);
    const inferred = inferenceByRow.get(row.rowKey);
    if (!inferred) {
      return {
        rowKey: row.rowKey,
        korean,
        english,
        releaseDate,
        stringId: row.stringId.trim(),
        action: 'skip',
        reason: 'String ID 분류 결과가 없습니다.',
      };
    }

    const feature = cleanSegment(inferred.feature, 'DEV');
    const screen = cleanSegment(inferred.screen, 'MAIN');
    const selectedTargetFile = featureFileName(feature, targetFiles);
    const manual = parseStringId(row.stringId);
    const effectiveType = manual?.type ?? inferred.type;
    const appliedRecord = index.byId.get(row.stringId.trim());
    if (appliedRecord && english && appliedRecord.normalizedText === english) {
      return {
        rowKey: row.rowKey,
        korean,
        english,
        releaseDate,
        stringId: appliedRecord.stringId,
        action: 'reuse',
        targetFile: appliedRecord.fileName,
        reason: 'JSON에 반영된 동일한 영문의 String ID를 유지합니다.',
      };
    }
    const matches = english
      ? findCompatibleMatches(index.byTextType, english, effectiveType)
      : [];
    const reusableEnglishMatch = findReusableMatch(matches);
    if (reusableEnglishMatch) {
      occupied.set(reusableEnglishMatch.stringId, { text: english, existing: true });
      return {
        rowKey: row.rowKey,
        korean,
        english,
        releaseDate,
        stringId: reusableEnglishMatch.stringId,
        action: 'reuse',
        targetFile: reusableEnglishMatch.fileName,
        reason: `동일한 Text와 Type의 ${reusableEnglishMatch.feature} 키를 재사용합니다.`,
      };
    }

    if (!english) {
      const koreanMatches = korean
        ? findCompatibleMatches(index.byKoreanType, korean, effectiveType)
        : [];
      const reusableKoreanMatch = findReusableMatch(koreanMatches)
        ?? koreanMatches.find((record) => record.feature === feature);
      if (reusableKoreanMatch) {
        return {
          rowKey: row.rowKey,
          korean,
          english,
          releaseDate,
          stringId: reusableKoreanMatch.stringId,
          action: 'reuse',
          targetFile: reusableKoreanMatch.fileName,
          reason: '동일한 국문과 Type의 기존 String ID를 재사용합니다.',
        };
      }
      if (crossFeatureFiles(koreanMatches, selectedTargetFile).size >= 2) {
        const stringId = allocate('COMMON', screen, effectiveType, english);
        return {
          rowKey: row.rowKey,
          korean,
          english,
          releaseDate,
          stringId,
          action: 'create',
          targetFile: 'ui_common.json',
          reason: '동일한 국문과 Type이 다른 두 피처 파일에 있어 COMMON 키를 생성합니다.',
        };
      }
      return {
        rowKey: row.rowKey,
        korean,
        english,
        releaseDate,
        stringId: row.stringId.trim(),
        action: 'skip',
        reason: '영문이 비어 있고 일치하는 기존 국문 키가 없습니다.',
      };
    }

    if (manual) {
      const current = occupied.get(row.stringId);
      if (!current) {
        occupied.set(row.stringId, { text: english, existing: false });
        return {
          rowKey: row.rowKey,
          korean,
          english,
          releaseDate,
          stringId: row.stringId,
          action: 'create',
          targetFile: featureFileName(manual.feature, targetFiles),
          reason: '사용자가 작성한 유효한 String ID를 유지합니다.',
        };
      }
      if (current.text === english) {
        return {
          rowKey: row.rowKey,
          korean,
          english,
          releaseDate,
          stringId: row.stringId,
          action: current.existing ? 'reuse' : 'create',
          targetFile: index.byId.get(row.stringId)?.fileName
            ?? featureFileName(manual.feature, targetFiles),
          reason: current.existing
            ? '동일한 기존 String ID를 재사용합니다.'
            : '다른 위키 행과 같은 Text의 String ID를 함께 사용합니다.',
        };
      }
      const stringId = allocate(manual.feature, manual.screen, manual.type, english);
      return {
        rowKey: row.rowKey,
        korean,
        english,
        releaseDate,
        stringId,
        action: 'renumber',
        targetFile: featureFileName(manual.feature, targetFiles),
        reason: 'String ID가 다른 영문과 충돌해 다음 번호로 변경합니다.',
      };
    }

    if (crossFeatureFiles(matches, selectedTargetFile).size >= 2) {
      const stringId = allocate('COMMON', screen, effectiveType, english);
      return {
        rowKey: row.rowKey,
        korean,
        english,
        releaseDate,
        stringId,
        action: 'create',
        targetFile: 'ui_common.json',
        reason: '동일한 Text와 Type이 다른 두 피처 파일에 있어 COMMON 키를 생성합니다.',
      };
    }

    const stringId = allocate(feature, screen, effectiveType, english);
    return {
      rowKey: row.rowKey,
      korean,
      english,
      releaseDate,
      stringId,
      action: row.stringId.trim() ? 'renumber' : 'create',
      targetFile: selectedTargetFile,
      reason: row.stringId.trim()
        ? 'String ID 형식 또는 Type이 올바르지 않아 새 번호를 생성합니다.'
        : '새 String ID를 생성합니다.',
    };
  });
}

export function findStringIdTypeIssues(
  rows: StringIdRow[],
  inferences: StringIdInference[],
): L10nIssue[] {
  const inferenceByRow = new Map(inferences.map((item) => [item.rowKey, item]));
  return rows.flatMap((row): L10nIssue[] => {
    const parsed = parseStringId(row.stringId);
    const inferred = inferenceByRow.get(row.rowKey);
    if (!parsed || !inferred || areTypesCompatible(parsed.type, inferred.type)) return [];
    return [{
      code: 'STRING_ID_TYPE_MISMATCH',
      rowKey: row.rowKey,
      korean: row.korean,
      message: `${row.stringId}의 Type ${parsed.type}과 판정 Type ${inferred.type}이 다릅니다.`,
    }];
  });
}

export function findStringIdCollisions(
  rows: StringIdRow[],
  index: StringIndex,
): L10nIssue[] {
  const issues: L10nIssue[] = [];
  const claimed = new Map<string, { english: string; korean: string; rowKey: string }>();
  for (const row of rows) {
    const stringId = row.stringId.trim();
    if (!stringId) continue;
    const english = normalizeStringText(row.english);
    const korean = normalizeStringText(row.korean);
    const existing = index.byId.get(stringId);
    const conflictsWithJson = Boolean(existing && english && existing.normalizedText !== english);
    const previous = claimed.get(stringId);
    const conflictsWithWiki = Boolean(previous
      && (previous.english && english
        ? previous.english !== english
        : previous.korean && korean
          ? previous.korean !== korean
          : false));
    if (conflictsWithJson || conflictsWithWiki) {
      issues.push({
        code: 'STRING_ID_COLLISION',
        rowKey: row.rowKey,
        korean: row.korean,
        message: `${stringId}가 서로 다른 스트링에 사용되었습니다.`,
      });
    }
    if (!previous) claimed.set(stringId, { english, korean, rowKey: row.rowKey });
  }
  return issues;
}
