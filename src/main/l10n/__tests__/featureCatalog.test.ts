import { describe, expect, it } from 'vitest';
import { InputFileData } from '../../../shared/l10nTypes';
import { buildFeatureCatalog, featureTargetMap } from '../featureCatalog';

const entry = { Text: 'TEXT', ReleaseDate: '2026-01-01' };

function files(entries: Record<string, InputFileData>) {
  return new Map(Object.entries(entries));
}

describe('buildFeatureCatalog', () => {
  it('extracts prefixes from keys and filters hidden legacy prefixes', () => {
    const options = buildFeatureCatalog(files({
      'ui_dev.json': {
        'TOS:MAIN_BODY_0': entry,
        'DUALMATCHMAKING:MAIN_BODY_0': entry,
        'CG:MAIN_BODY_0': entry,
      },
      'ui_lobby.json': {
        'REPUTATION:MAIN_BODY_0': entry,
      },
      'ui_common.json': {
        'COMMON:MAIN_BODY_0': entry,
      },
    }));

    expect(options).toEqual([
      { prefix: 'REPUTATION', targetFile: 'ui_lobby.json' },
      { prefix: 'TOS', targetFile: 'ui_dev.json' },
    ]);
  });

  it('uses the confirmed target for a prefix found in multiple files', () => {
    const options = buildFeatureCatalog(files({
      'ui_bridge.json': {
        'REPUTATION:OLD_BODY_0': entry,
      },
      'ui_lobby.json': {
        'REPUTATION:MAIN_BODY_0': entry,
      },
    }));

    expect(options).toEqual([
      { prefix: 'REPUTATION', targetFile: 'ui_lobby.json' },
    ]);
    expect(featureTargetMap(options).get('REPUTATION')).toBe('ui_lobby.json');
  });

  it('keeps a prefix even when its legacy key uses an unknown type', () => {
    const options = buildFeatureCatalog(files({
      'ui_bn.json': {
        'BN:LEGACY_TEXT_0': entry,
      },
    }));

    expect(options).toEqual([{ prefix: 'BN', targetFile: 'ui_bn.json' }]);
  });
});
