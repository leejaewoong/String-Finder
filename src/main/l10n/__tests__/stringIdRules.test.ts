import { describe, expect, it } from 'vitest';
import { InputFileData } from '../../../shared/l10nTypes';
import {
  buildStringIndex,
  decideStringIds,
  StringIdInference,
  StringIdRow,
} from '../stringIdRules';

function files(entries: Record<string, InputFileData>) {
  return new Map(Object.entries(entries));
}

const row = (overrides: Partial<StringIdRow> = {}): StringIdRow => ({
  rowKey: 'row-1',
  english: 'PLAY',
  stringId: '',
  ...overrides,
});

const inference = (overrides: Partial<StringIdInference> = {}): StringIdInference => ({
  rowKey: 'row-1',
  feature: 'CLAN',
  screen: 'MAIN',
  type: 'BUTTON',
  ...overrides,
});

describe('buildStringIndex', () => {
  it('normalizes only outer whitespace and line endings', () => {
    const index = buildStringIndex(files({
      'ui_clan.json': {
        'CLAN:MAIN_BODY_0': { Text: '  Line 1\r\nLine 2  ', ReleaseDate: '2025-01-01' },
      },
    }));

    expect(index.records[0].normalizedText).toBe('Line 1\nLine 2');
  });
});

describe('decideStringIds', () => {
  it('reuses an arbitrary existing key with the same text and type in the inferred feature', () => {
    const index = buildStringIndex(files({
      'ui_clan.json': {
        'CLAN:OTHER_BUTTON_4': { Text: 'PLAY', ReleaseDate: '2025-01-01' },
      },
    }));

    expect(decideStringIds([row()], [inference()], index, '2026-12-03')[0]).toMatchObject({
      stringId: 'CLAN:OTHER_BUTTON_4',
      action: 'reuse',
      targetFile: 'ui_clan.json',
    });
  });

  it('recommends the latest COMMON key with matching text and type even over a manual feature key', () => {
    const index = buildStringIndex(files({
      'ui_common.json': {
        'COMMON:OLD_BUTTON_0': { Text: 'PLAY', ReleaseDate: '2025-01-01' },
        'COMMON:NEW_BUTTON_0': { Text: 'PLAY', ReleaseDate: '2026-01-01' },
      },
    }));

    expect(decideStringIds(
      [row({ stringId: 'CLAN:MAIN_BUTTON_7' })],
      [inference()],
      index,
      '2026-12-03',
    )[0]).toMatchObject({
      stringId: 'COMMON:NEW_BUTTON_0',
      action: 'reuse',
    });
  });

  it('creates a COMMON key when matching text and type span two feature files including ui_dev', () => {
    const index = buildStringIndex(files({
      'ui_dev.json': {
        'DEV:LAB_BUTTON_0': { Text: 'PLAY', ReleaseDate: '2025-01-01' },
      },
      'ui_clan.json': {},
    }));

    expect(decideStringIds([row()], [inference()], index, '2026-12-03')[0]).toMatchObject({
      stringId: 'COMMON:MAIN_BUTTON_0',
      action: 'create',
      targetFile: 'ui_common.json',
    });
  });

  it('does not count ui_common as a feature file when deciding cross-feature promotion', () => {
    const index = buildStringIndex(files({
      'ui_common.json': {
        'COMMON:MAIN_BODY_0': { Text: 'PLAY', ReleaseDate: '2025-01-01' },
      },
      'ui_clan.json': {},
    }));

    const decision = decideStringIds([row()], [inference()], index, '2026-12-03')[0];
    expect(decision.stringId).toBe('CLAN:MAIN_BUTTON_0');
  });

  it('preserves a valid manual ID unless it collides with different text', () => {
    const index = buildStringIndex(files({
      'ui_clan.json': {
        'CLAN:MAIN_BUTTON_3': { Text: 'STOP', ReleaseDate: '2025-01-01' },
        'CLAN:MAIN_BUTTON_8': { Text: 'OTHER', ReleaseDate: '2025-01-01' },
      },
    }));

    const [renumbered] = decideStringIds(
      [row({ stringId: 'CLAN:MAIN_BUTTON_3' })],
      [inference()],
      index,
      '2026-12-03',
    );
    expect(renumbered).toMatchObject({
      stringId: 'CLAN:MAIN_BUTTON_9',
      action: 'renumber',
    });

    const [preserved] = decideStringIds(
      [row({ stringId: 'CLAN:ALT_BUTTON_1' })],
      [inference()],
      index,
      '2026-12-03',
    );
    expect(preserved).toMatchObject({
      stringId: 'CLAN:ALT_BUTTON_1',
      action: 'create',
    });
  });

  it('renumbers later wiki rows that use one ID for different English text', () => {
    const index = buildStringIndex(files({ 'ui_clan.json': {} }));
    const decisions = decideStringIds(
      [
        row({ rowKey: 'row-1', english: 'PLAY', stringId: 'CLAN:MAIN_BUTTON_0' }),
        row({ rowKey: 'row-2', english: 'STOP', stringId: 'CLAN:MAIN_BUTTON_0' }),
      ],
      [
        inference({ rowKey: 'row-1' }),
        inference({ rowKey: 'row-2' }),
      ],
      index,
      '2026-12-03',
    );

    expect(decisions.map((decision) => decision.stringId)).toEqual([
      'CLAN:MAIN_BUTTON_0',
      'CLAN:MAIN_BUTTON_1',
    ]);
    expect(decisions[1].action).toBe('renumber');
  });

  it('keeps text matching case-sensitive', () => {
    const index = buildStringIndex(files({
      'ui_clan.json': {
        'CLAN:MAIN_BUTTON_0': { Text: 'Play', ReleaseDate: '2025-01-01' },
      },
    }));

    expect(decideStringIds([row({ english: 'PLAY' })], [inference()], index, '2026-12-03')[0].stringId)
      .toBe('CLAN:MAIN_BUTTON_1');
  });
});
