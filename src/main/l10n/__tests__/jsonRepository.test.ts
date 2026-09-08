import { mkdtemp, readFile, rm, writeFile, mkdir, copyFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { StringIdDecision } from '../stringIdRules';
import {
  applyJsonChanges,
  loadInputFiles,
  planJsonChanges,
} from '../jsonRepository';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'string-finder-json-'));
  roots.push(root);
  const inputRoot = path.join(root, 'input');
  await mkdir(inputRoot);
  await writeFile(path.join(inputRoot, 'ui_clan.json'), JSON.stringify({
    'CLAN:MAIN_BUTTON_0': { Text: 'PLAY', ReleaseDate: '2025-01-01' },
  }, null, 4));
  await writeFile(path.join(inputRoot, 'ui_common.json'), '{}');
  await writeFile(path.join(root, 'ui_ko.json'), JSON.stringify({
    'CLAN:MAIN_BUTTON_0': '플레이',
  }, null, 4));
  return { root, inputRoot };
}

const decision = (overrides: Partial<StringIdDecision> = {}): StringIdDecision => ({
  rowKey: 'row-1',
  korean: '신규',
  english: 'NEW',
  releaseDate: '2026-12-03',
  stringId: 'CLAN:MAIN_BUTTON_1',
  action: 'create',
  targetFile: 'ui_clan.json',
  ...overrides,
});

describe('JSON change planning', () => {
  it('loads the Korean localization map next to the input directory', async () => {
    const { root } = await fixture();

    const loaded = await loadInputFiles(root);

    expect(loaded.koreanById).toEqual(new Map([
      ['CLAN:MAIN_BUTTON_0', '플레이'],
    ]));
  });

  it('does not modify JSON for any reused key', async () => {
    const { root } = await fixture();
    const loaded = await loadInputFiles(root);

    const plan = planJsonChanges([decision({
      stringId: 'CLAN:MAIN_BUTTON_0',
      english: 'PLAY',
      action: 'reuse',
    })], loaded);

    expect(plan.files).toHaveLength(0);
  });

  it('preserves existing order and appends new keys in String ID order', async () => {
    const { root } = await fixture();
    const loaded = await loadInputFiles(root);

    const plan = planJsonChanges([
      decision({ stringId: 'CLAN:MAIN_BUTTON_2', english: 'SECOND' }),
      decision({ stringId: 'CLAN:MAIN_BUTTON_1', english: 'FIRST' }),
    ], loaded);

    expect(plan.issues).toEqual([]);
    expect(plan.files[0].fileName).toBe('ui_clan.json');
    expect(Object.keys(JSON.parse(plan.files[0].after))).toEqual([
      'CLAN:MAIN_BUTTON_0',
      'CLAN:MAIN_BUTTON_1',
      'CLAN:MAIN_BUTTON_2',
    ]);
  });

  it('reports a missing target file without blocking other planned files', async () => {
    const { root } = await fixture();
    const loaded = await loadInputFiles(root);

    const plan = planJsonChanges([
      decision({ targetFile: 'ui_missing.json', stringId: 'MISSING:MAIN_BUTTON_0' }),
      decision({ targetFile: 'ui_common.json', stringId: 'COMMON:MAIN_BUTTON_0' }),
    ], loaded);

    expect(plan.issues[0]).toMatchObject({ code: 'TARGET_FILE_MISSING', rowKey: 'row-1' });
    expect(plan.files.map((file) => file.fileName)).toEqual(['ui_common.json']);
  });

  it('accepts a key-derived target file whose name differs from the prefix', async () => {
    const { root, inputRoot } = await fixture();
    await writeFile(path.join(inputRoot, 'ui_lobby.json'), JSON.stringify({
      'REPUTATION:REFERENCE_BODY_0': { Text: 'REFERENCE', ReleaseDate: '2025-01-01' },
    }));
    const loaded = await loadInputFiles(root);

    const plan = planJsonChanges([decision({
      stringId: 'REPUTATION:MAIN_BUTTON_0',
      targetFile: 'ui_lobby.json',
    })], loaded);

    expect(plan.issues).toEqual([]);
    expect(plan.files[0].fileName).toBe('ui_lobby.json');
  });
});

describe('applyJsonChanges', () => {
  it('backs up originals and rolls every replaced file back when a later replacement fails', async () => {
    const { root, inputRoot } = await fixture();
    await writeFile(path.join(inputRoot, 'ui_dev.json'), '{}');
    const loaded = await loadInputFiles(root);
    const plan = planJsonChanges([
      decision(),
      decision({
        rowKey: 'row-2',
        targetFile: 'ui_dev.json',
        stringId: 'DEV:MAIN_BUTTON_0',
      }),
    ], loaded);
    const beforeClan = await readFile(path.join(inputRoot, 'ui_clan.json'), 'utf8');
    let replacements = 0;

    await expect(applyJsonChanges(plan, path.join(root, 'backups'), async (source, target) => {
      replacements += 1;
      if (replacements === 2) throw new Error('injected failure');
      await copyFile(source, target);
    })).rejects.toThrow('injected failure');

    expect(await readFile(path.join(inputRoot, 'ui_clan.json'), 'utf8')).toBe(beforeClan);
    expect(JSON.parse(await readFile(path.join(inputRoot, 'ui_dev.json'), 'utf8'))).toEqual({});
  });
});
