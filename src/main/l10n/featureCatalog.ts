import { InputFileData, L10nFeatureOption } from '../../shared/l10nTypes';

const HIDDEN_FEATURE_PREFIXES = new Set([
  'CG',
  'CW',
  'DUALMATCHMAKING',
  'F2POUTGAME',
  'LABS',
  'LPCSTORE',
  'MASTERY',
  'MFRIEND',
  'MINIPASS1',
  'MISSION_TOOLTIP',
  'MM',
  'NEWJEANS',
  'NEWSPAGE',
  ...Array.from({ length: 32 }, (_, index) => `SURVIVORPASS${index + 3}`),
  'USAGEPOLICYINFO',
  'WORSKHOP',
  'ZK',
  'AIROYALE02',
  'AIROYALE03',
  'AR',
  'BP',
  'BP2',
  'BP3',
  'CONSOLE',
  'CONSOLEBUYPASSPOPUP',
  'CONSOLECNP',
  'CONSOLELOGINEVENT',
  'CONSOLESEASON',
  'CPP2',
  'CROWDPLAY',
  'CUSTOMIZATION',
  'FT',
  'GCOINJP',
  'INVITE',
  'KANGAROO',
  'LPC',
  'MAINTENANCE',
  'MARKETINGWEBEVENT',
  'MODIFICATION',
  'OPENSOURCE',
  'PGI',
  'PS4',
  'RF',
  'RG',
  'SALESITEM',
  'SEASON',
  'SEASON9',
  'SEASON10',
  'SEASON12',
  'TRAININGMODETEST',
  'ULABS',
  'WM',
  'WN',
  'XB',
  'XIMBAN',
  'MAP',
]);

const PREFERRED_TARGET_FILES: Readonly<Record<string, string>> = {
  ARCADE: 'ui_Arcade.json',
  EOM: 'ui_EOM.json',
  LOBBY: 'ui_lobby.json',
  PREVIEW: 'ui_preview.json',
  RANK: 'ui_rank.json',
  REPUTATION: 'ui_lobby.json',
  STORE: 'ui_store.json',
  TOS: 'ui_dev.json',
};

function selectTargetFile(prefix: string, candidates: Set<string>): string {
  const preferred = PREFERRED_TARGET_FILES[prefix];
  if (preferred && candidates.has(preferred)) return preferred;

  const conventional = `ui_${prefix.toLowerCase()}.json`;
  if (candidates.has(conventional)) return conventional;

  return [...candidates].sort((a, b) => a.localeCompare(b))[0];
}

export function buildFeatureCatalog(
  files: ReadonlyMap<string, InputFileData>,
): L10nFeatureOption[] {
  const filesByPrefix = new Map<string, Set<string>>();

  for (const [fileName, data] of files) {
    for (const stringId of Object.keys(data)) {
      const prefix = stringId.match(/^([A-Z0-9_]+):/)?.[1];
      if (!prefix || prefix === 'COMMON' || HIDDEN_FEATURE_PREFIXES.has(prefix)) continue;

      const targetFiles = filesByPrefix.get(prefix) ?? new Set<string>();
      targetFiles.add(fileName);
      filesByPrefix.set(prefix, targetFiles);
    }
  }

  return [...filesByPrefix]
    .map(([prefix, targetFiles]) => ({
      prefix,
      targetFile: selectTargetFile(prefix, targetFiles),
    }))
    .sort((a, b) => a.prefix.localeCompare(b.prefix));
}

export function featureTargetMap(
  options: L10nFeatureOption[],
): Map<string, string> {
  return new Map(options.map((option) => [option.prefix, option.targetFile]));
}
