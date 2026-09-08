import { describe, expect, it } from 'vitest';
import { InputFileData } from '../../../shared/l10nTypes';
import {
  buildStringIndex,
  decideStringIds,
  findStringIdCollisions,
  findStringIdTypeIssues,
  StringIdInference,
  StringIdRow,
} from '../stringIdRules';

function files(entries: Record<string, InputFileData>) {
  return new Map(Object.entries(entries));
}

const row = (overrides: Partial<StringIdRow> = {}): StringIdRow => ({
  rowKey: 'row-1',
  korean: '플레이',
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
  it('reuses the latest Korean and type match before review, then prefers English after review', () => {
    const index = buildStringIndex(files({
      'ui_common.json': {
        'COMMON:OLD_BUTTON_0': { Text: 'OLD PLAY', ReleaseDate: '2025-01-01' },
        'COMMON:KOREAN_BUTTON': { Text: 'NEW PLAY', ReleaseDate: '2026-01-01' },
        'COMMON:BODY_BODY_0': { Text: 'BODY PLAY', ReleaseDate: '2027-01-01' },
        'COMMON:ENGLISH_BUTTON_0': { Text: 'PLAY', ReleaseDate: '2024-01-01' },
      },
    }), new Map([
      ['COMMON:OLD_BUTTON_0', '플레이'],
      ['COMMON:KOREAN_BUTTON', '플레이'],
      ['COMMON:ENGLISH_BUTTON_0', '다른 국문'],
      ['COMMON:BODY_BODY_0', '플레이'],
    ]));

    const beforeReview = decideStringIds(
      [row({ english: '' })],
      [inference()],
      index,
      '2026-12-03',
    )[0];
    const afterReview = decideStringIds(
      [row({ english: 'PLAY' })],
      [inference()],
      index,
      '2026-12-03',
    )[0];

    expect(beforeReview).toMatchObject({
      stringId: 'COMMON:KOREAN_BUTTON',
      action: 'reuse',
      reason: '동일한 국문과 Type의 기존 String ID를 재사용합니다.',
    });
    expect(afterReview).toMatchObject({
      stringId: 'COMMON:ENGLISH_BUTTON_0',
      action: 'reuse',
    });
  });

  it('does not automatically reuse a matching key from the selected feature', () => {
    const index = buildStringIndex(files({
      'ui_clan.json': {
        'CLAN:OTHER_BUTTON_4': { Text: 'PLAY', ReleaseDate: '2025-01-01' },
      },
    }));

    expect(decideStringIds([row()], [inference()], index, '2026-12-03')[0]).toMatchObject({
      stringId: 'CLAN:MAIN_BUTTON_0',
      action: 'create',
      targetFile: 'ui_clan.json',
    });
  });

  it('prefers COMMON over a newer matching XB key and uses XB as fallback', () => {
    const index = buildStringIndex(files({
      'ui_common.json': {
        'COMMON:MAIN_BUTTON_0': { Text: 'PLAY', ReleaseDate: '2025-01-01' },
      },
      'ui_dev.json': {
        'XB:MAIN_BUTTON_0': { Text: 'PLAY', ReleaseDate: '2027-01-01' },
        'XB:STOP_BUTTON': { Text: 'STOP', ReleaseDate: '2026-01-01' },
      },
    }));

    const [common, xb] = decideStringIds(
      [row(), row({ rowKey: 'row-2', english: 'STOP' })],
      [inference(), inference({ rowKey: 'row-2' })],
      index,
      '2026-12-03',
    );

    expect(common).toMatchObject({ stringId: 'COMMON:MAIN_BUTTON_0', action: 'reuse' });
    expect(xb).toMatchObject({ stringId: 'XB:STOP_BUTTON', action: 'reuse' });
  });

  it('reuses the legacy COMMON back key by Korean and type before English review', () => {
    const index = buildStringIndex(files({
      'ui_common.json': {
        'COMMON:BACK_BUTTON': { Text: 'BACK', ReleaseDate: '2022-11-09' },
      },
    }), new Map([
      ['COMMON:BACK_BUTTON', '뒤로 가기'],
    ]));

    expect(decideStringIds(
      [row({ korean: '뒤로 가기', english: '' })],
      [inference()],
      index,
      '2026-12-03',
    )[0]).toMatchObject({
      stringId: 'COMMON:BACK_BUTTON',
      action: 'reuse',
      reason: '동일한 국문과 Type의 기존 String ID를 재사용합니다.',
    });
  });

  it('reuses a Korean-only match from the selected prefix but not an English match', () => {
    const index = buildStringIndex(files({
      'ui_common.json': {
        'CLAN:OTHER_BUTTON_0': { Text: 'PLAY', ReleaseDate: '2027-01-01' },
      },
      'ui_dev.json': {
        'TOS:OTHER_BUTTON_0': { Text: 'PLAY', ReleaseDate: '2026-01-01' },
      },
      'ui_clan.json': {},
    }), new Map([
      ['CLAN:OTHER_BUTTON_0', '플레이'],
      ['TOS:OTHER_BUTTON_0', '플레이'],
    ]));

    const [englishMatch, koreanOnlyMatch] = decideStringIds(
      [row(), row({ rowKey: 'row-2', english: '' })],
      [inference(), inference({ rowKey: 'row-2' })],
      index,
      '2026-12-03',
    );

    expect(englishMatch).toMatchObject({
      stringId: 'CLAN:MAIN_BUTTON_0',
      action: 'create',
    });
    expect(koreanOnlyMatch).toMatchObject({
      stringId: 'CLAN:OTHER_BUTTON_0',
      action: 'reuse',
    });
  });

  it('treats BODY and FLOAT as compatible when reusing the latest Korean key from the selected prefix', () => {
    const index = buildStringIndex(files({
      'ui_clan.json': {
        'CLAN:OLD_BODY_0': { Text: 'OLD PREVIEW', ReleaseDate: '2025-01-01' },
        'CLAN:NEW_FLOAT_0': { Text: 'NEW PREVIEW', ReleaseDate: '2026-01-01' },
      },
    }), new Map([
      ['CLAN:OLD_BODY_0', '미리보기'],
      ['CLAN:NEW_FLOAT_0', '미리보기'],
    ]));

    expect(decideStringIds(
      [row({ korean: '미리보기', english: '' })],
      [inference({ type: 'BODY' })],
      index,
      '2026-12-03',
    )[0]).toMatchObject({
      stringId: 'CLAN:NEW_FLOAT_0',
      action: 'reuse',
      targetFile: 'ui_clan.json',
    });
  });

  it('treats BODY and FLOAT as compatible when reusing a COMMON key by English', () => {
    const index = buildStringIndex(files({
      'ui_common.json': {
        'COMMON:MAIN_FLOAT_0': { Text: 'PLAY', ReleaseDate: '2026-01-01' },
      },
    }));

    expect(decideStringIds(
      [row()],
      [inference({ type: 'BODY' })],
      index,
      '2026-12-03',
    )[0]).toMatchObject({
      stringId: 'COMMON:MAIN_FLOAT_0',
      action: 'reuse',
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

  it('creates a COMMON key when matching text and type exist in two other feature files', () => {
    const index = buildStringIndex(files({
      'ui_bridge.json': {
        'BRIDGE:LAB_BUTTON_0': { Text: 'PLAY', ReleaseDate: '2025-01-01' },
      },
      'ui_store.json': {
        'STORE:LAB_BUTTON_0': { Text: 'PLAY', ReleaseDate: '2025-01-01' },
      },
      'ui_clan.json': {},
    }));

    expect(decideStringIds([row()], [inference()], index, '2026-12-03')[0]).toMatchObject({
      stringId: 'COMMON:MAIN_BUTTON_0',
      action: 'create',
      targetFile: 'ui_common.json',
    });
  });

  it('creates a COMMON key from Korean and inferred type before English review', () => {
    const index = buildStringIndex(files({
      'ui_bridge.json': {
        'BRIDGE:LAB_BUTTON_0': { Text: 'EQUIP', ReleaseDate: '2025-01-01' },
      },
      'ui_store.json': {
        'STORE:LAB_BUTTON_0': { Text: 'APPLY', ReleaseDate: '2025-01-01' },
      },
      'ui_clan.json': {},
    }), new Map([
      ['BRIDGE:LAB_BUTTON_0', '장착'],
      ['STORE:LAB_BUTTON_0', '장착'],
    ]));

    expect(decideStringIds(
      [row({ korean: '장착', english: '' })],
      [inference({ type: 'BUTTON' })],
      index,
      '2026-12-03',
    )[0]).toMatchObject({
      stringId: 'COMMON:MAIN_BUTTON_0',
      action: 'create',
      targetFile: 'ui_common.json',
      reason: '동일한 국문과 Type이 다른 두 피처 파일에 있어 COMMON 키를 생성합니다.',
    });
  });

  it('counts BODY and FLOAT together when promoting a Korean-only string to COMMON', () => {
    const index = buildStringIndex(files({
      'ui_bridge.json': {
        'BRIDGE:LAB_BODY_0': { Text: 'EQUIP', ReleaseDate: '2025-01-01' },
      },
      'ui_store.json': {
        'STORE:LAB_FLOAT_0': { Text: 'APPLY', ReleaseDate: '2025-01-01' },
      },
      'ui_clan.json': {},
    }), new Map([
      ['BRIDGE:LAB_BODY_0', '장착'],
      ['STORE:LAB_FLOAT_0', '장착'],
    ]));

    expect(decideStringIds(
      [row({ korean: '장착', english: '' })],
      [inference({ type: 'BODY' })],
      index,
      '2026-12-03',
    )[0]).toMatchObject({
      stringId: 'COMMON:MAIN_BODY_0',
      action: 'create',
      targetFile: 'ui_common.json',
    });
  });

  it('does not reuse a non-XB key from ui_dev', () => {
    const index = buildStringIndex(files({
      'ui_dev.json': {
        'TOS:LAB_BUTTON_0': { Text: 'PLAY', ReleaseDate: '2025-01-01' },
      },
      'ui_store.json': {
        'STORE:LAB_BUTTON_0': { Text: 'PLAY', ReleaseDate: '2025-01-01' },
      },
      'ui_clan.json': {
        'CLAN:OLD_BUTTON_0': { Text: 'PLAY', ReleaseDate: '2025-01-01' },
      },
    }));

    expect(decideStringIds([row()], [inference()], index, '2026-12-03')[0]).toMatchObject({
      stringId: 'CLAN:MAIN_BUTTON_0',
      action: 'create',
    });
  });

  it('does not count the selected feature as one of two other feature files', () => {
    const index = buildStringIndex(files({
      'ui_store.json': {
        'STORE:LAB_BUTTON_0': { Text: 'PLAY', ReleaseDate: '2025-01-01' },
      },
      'ui_clan.json': {
        'CLAN:OLD_BUTTON_0': { Text: 'PLAY', ReleaseDate: '2025-01-01' },
      },
    }));

    expect(decideStringIds([row()], [inference()], index, '2026-12-03')[0]).toMatchObject({
      stringId: 'CLAN:MAIN_BUTTON_0',
      action: 'create',
    });
  });

  it('uses the catalog target file for a selected feature', () => {
    const index = buildStringIndex(files({ 'ui_lobby.json': {} }));
    const targets = new Map([['REPUTATION', 'ui_lobby.json']]);

    expect(decideStringIds(
      [row()],
      [inference({ feature: 'REPUTATION' })],
      index,
      '2026-12-03',
      targets,
    )[0]).toMatchObject({
      stringId: 'REPUTATION:MAIN_BUTTON_0',
      targetFile: 'ui_lobby.json',
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

  it('locks a written ID that already exists in JSON with the same English', () => {
    const index = buildStringIndex(files({
      'ui_common.json': {
        'COMMON:MAIN_BUTTON_0': { Text: 'PLAY', ReleaseDate: '2026-01-01' },
      },
      'ui_clan.json': {
        'CLAN:MAIN_BUTTON_7': { Text: 'PLAY', ReleaseDate: '2025-01-01' },
      },
    }));

    expect(decideStringIds(
      [row({ stringId: 'CLAN:MAIN_BUTTON_7' })],
      [inference()],
      index,
      '2026-12-03',
    )[0]).toMatchObject({
      stringId: 'CLAN:MAIN_BUTTON_7',
      action: 'reuse',
      reason: 'JSON에 반영된 동일한 영문의 String ID를 유지합니다.',
    });
  });

  it('uses the written ID type for COMMON lookup and reports an LLM type difference', () => {
    const typedRow = row({ stringId: 'CLAN:MAIN_BODY_7' });
    const inferred = inference({ type: 'BUTTON' });
    const index = buildStringIndex(files({
      'ui_common.json': {
        'COMMON:MAIN_BODY_0': { Text: 'PLAY', ReleaseDate: '2026-01-01' },
      },
    }));

    expect(decideStringIds(
      [typedRow],
      [inferred],
      index,
      '2026-12-03',
    )[0]).toMatchObject({
      stringId: 'COMMON:MAIN_BODY_0',
      action: 'reuse',
    });
    expect(findStringIdTypeIssues([typedRow], [inferred])).toEqual([
      expect.objectContaining({
        code: 'STRING_ID_TYPE_MISMATCH',
        rowKey: 'row-1',
      }),
    ]);
  });

  it('does not report BODY and FLOAT as a String ID type mismatch', () => {
    expect(findStringIdTypeIssues(
      [row({ stringId: 'CLAN:MAIN_BODY_7' })],
      [inference({ type: 'FLOAT' })],
    )).toEqual([]);
  });

  it('reserves IDs from Figma-tag-missing rows when allocating a new number', () => {
    const reserved = row({
      rowKey: 'missing-row',
      korean: '이전 버튼',
      english: 'OLD BUTTON',
      stringId: 'CLAN:MAIN_BUTTON_0',
    });

    expect(decideStringIds(
      [row()],
      [inference()],
      buildStringIndex(files({ 'ui_clan.json': {} })),
      '2026-12-03',
      new Map(),
      [reserved],
    )[0].stringId).toBe('CLAN:MAIN_BUTTON_1');
  });

  it('reports different wiki text claiming the same ID, including missing rows', () => {
    const issues = findStringIdCollisions([
      row({ rowKey: 'active', english: 'PLAY', stringId: 'CLAN:MAIN_BUTTON_0' }),
      row({ rowKey: 'missing', english: 'STOP', stringId: 'CLAN:MAIN_BUTTON_0' }),
    ], buildStringIndex(files({ 'ui_clan.json': {} })));

    expect(issues).toEqual([
      expect.objectContaining({
        code: 'STRING_ID_COLLISION',
        rowKey: 'missing',
      }),
    ]);
  });

  it('does not report a collision when Korean matches and only one row has English', () => {
    const issues = findStringIdCollisions([
      row({ rowKey: 'before-review', english: '', stringId: 'COMMON:PLAY_BUTTON' }),
      row({ rowKey: 'after-review', english: 'PLAY', stringId: 'COMMON:PLAY_BUTTON' }),
    ], buildStringIndex(files({ 'ui_common.json': {} })));

    expect(issues).toEqual([]);
  });
});
