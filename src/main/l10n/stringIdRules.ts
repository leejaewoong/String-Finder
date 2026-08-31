import { InputFileData } from '../../shared/l10nTypes';

export const STRING_ID_TYPES = [
  'ALL',
  'GNB',
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
  releaseDate: string;
  fileName: string;
}

export interface StringIndex {
  records: ExistingStringRecord[];
  byId: Map<string, ExistingStringRecord>;
  byTextType: Map<string, ExistingStringRecord[]>;
}

export interface StringIdDecision {
  rowKey: string;
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

function textTypeKey(text: string, type: StringIdType): string {
  return `${type}\u0000${normalizeStringText(text)}`;
}

function featureFileName(feature: string): string {
  return feature === 'COMMON' ? 'ui_common.json' : `ui_${feature.toLowerCase()}.json`;
}

function comparePreferredRecord(a: ExistingStringRecord, b: ExistingStringRecord): number {
  return b.releaseDate.localeCompare(a.releaseDate) || a.stringId.localeCompare(b.stringId);
}

export function buildStringIndex(files: Map<string, InputFileData>): StringIndex {
  const records: ExistingStringRecord[] = [];
  const byId = new Map<string, ExistingStringRecord>();
  const byTextType = new Map<string, ExistingStringRecord[]>();

  for (const [fileName, data] of files) {
    for (const [stringId, value] of Object.entries(data)) {
      const parsed = parseStringId(stringId);
      if (!parsed) continue;
      const record: ExistingStringRecord = {
        ...parsed,
        stringId,
        text: value.Text,
        normalizedText: normalizeStringText(value.Text),
        releaseDate: value.ReleaseDate,
        fileName,
      };
      records.push(record);
      byId.set(stringId, record);
      const key = textTypeKey(record.text, record.type);
      const matches = byTextType.get(key) ?? [];
      matches.push(record);
      byTextType.set(key, matches);
    }
  }

  for (const matches of byTextType.values()) {
    matches.sort(comparePreferredRecord);
  }
  return { records, byId, byTextType };
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
): StringIdDecision[] {
  const inferenceByRow = new Map(inferences.map((item) => [item.rowKey, item]));
  const occupied = new Map<string, { text: string; existing: boolean }>();
  index.records.forEach((record) => occupied.set(record.stringId, {
    text: record.normalizedText,
    existing: true,
  }));

  const plannedFeatures = new Map<string, Set<string>>();
  for (const row of rows) {
    const inferred = inferenceByRow.get(row.rowKey);
    if (!inferred || !normalizeStringText(row.english)) continue;
    const key = textTypeKey(row.english, inferred.type);
    const targetFiles = plannedFeatures.get(key) ?? new Set<string>();
    targetFiles.add(featureFileName(cleanSegment(inferred.feature, 'DEV')));
    plannedFeatures.set(key, targetFiles);
  }

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
    const inferred = inferenceByRow.get(row.rowKey);
    if (!inferred || !english) {
      return {
        rowKey: row.rowKey,
        english,
        releaseDate,
        stringId: row.stringId.trim(),
        action: 'skip',
        reason: !english ? '영문이 비어 있습니다.' : 'String ID 분류 결과가 없습니다.',
      };
    }

    const feature = cleanSegment(inferred.feature, 'DEV');
    const screen = cleanSegment(inferred.screen, 'MAIN');
    const matches = index.byTextType.get(textTypeKey(english, inferred.type)) ?? [];
    const common = matches.find((record) => record.feature === 'COMMON');
    if (common) {
      occupied.set(common.stringId, { text: english, existing: true });
      return {
        rowKey: row.rowKey,
        english,
        releaseDate,
        stringId: common.stringId,
        action: 'reuse',
        targetFile: common.fileName,
        reason: '동일한 Text와 Type의 COMMON 키를 재사용합니다.',
      };
    }

    const crossFeatureFiles = new Set(
      matches
        .filter((record) => record.fileName.toLowerCase() !== 'ui_common.json')
        .map((record) => record.fileName.toLowerCase()),
    );
    for (const fileName of plannedFeatures.get(textTypeKey(english, inferred.type)) ?? []) {
      if (fileName.toLowerCase() !== 'ui_common.json') crossFeatureFiles.add(fileName.toLowerCase());
    }
    if (crossFeatureFiles.size >= 2) {
      const stringId = allocate('COMMON', screen, inferred.type, english);
      return {
        rowKey: row.rowKey,
        english,
        releaseDate,
        stringId,
        action: 'create',
        targetFile: 'ui_common.json',
        reason: '동일한 Text와 Type이 여러 피처 파일에 있어 COMMON 키를 생성합니다.',
      };
    }

    const manual = parseStringId(row.stringId);
    if (manual && manual.type === inferred.type) {
      const current = occupied.get(row.stringId);
      if (!current) {
        occupied.set(row.stringId, { text: english, existing: false });
        return {
          rowKey: row.rowKey,
          english,
          releaseDate,
          stringId: row.stringId,
          action: 'create',
          targetFile: featureFileName(manual.feature),
          reason: '사용자가 작성한 유효한 String ID를 유지합니다.',
        };
      }
      if (current.text === english) {
        return {
          rowKey: row.rowKey,
          english,
          releaseDate,
          stringId: row.stringId,
          action: 'reuse',
          targetFile: featureFileName(manual.feature),
          reason: '동일한 기존 String ID를 재사용합니다.',
        };
      }
      const stringId = allocate(manual.feature, manual.screen, manual.type, english);
      return {
        rowKey: row.rowKey,
        english,
        releaseDate,
        stringId,
        action: 'renumber',
        targetFile: featureFileName(manual.feature),
        reason: 'String ID가 다른 영문과 충돌해 다음 번호로 변경합니다.',
      };
    }

    const sameFeature = matches.find((record) => record.feature === feature);
    if (sameFeature) {
      occupied.set(sameFeature.stringId, { text: english, existing: true });
      return {
        rowKey: row.rowKey,
        english,
        releaseDate,
        stringId: sameFeature.stringId,
        action: 'reuse',
        targetFile: sameFeature.fileName,
        reason: '같은 피처의 기존 Text와 Type 키를 재사용합니다.',
      };
    }

    const stringId = allocate(feature, screen, inferred.type, english);
    return {
      rowKey: row.rowKey,
      english,
      releaseDate,
      stringId,
      action: row.stringId.trim() ? 'renumber' : 'create',
      targetFile: featureFileName(feature),
      reason: row.stringId.trim()
        ? 'String ID 형식 또는 Type이 올바르지 않아 새 번호를 생성합니다.'
        : '새 String ID를 생성합니다.',
    };
  });
}
