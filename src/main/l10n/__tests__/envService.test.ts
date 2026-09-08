import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ensureEnvFile,
  getL10nConfigStatus,
  resolveEnvPath,
} from '../envService';

const createdPaths: string[] = [];

afterEach(async () => {
  await Promise.all(createdPaths.splice(0).map((createdPath) =>
    rm(createdPath, { recursive: true, force: true })
  ));
});

describe('resolveEnvPath', () => {
  it('uses the project .env while developing', () => {
    expect(resolveEnvPath(false, 'C:\\Users\\me\\AppData\\Roaming', 'C:\\repo'))
      .toBe('C:\\repo\\.env');
  });

  it('uses the String-Finder app data folder when packaged', () => {
    expect(resolveEnvPath(true, 'C:\\Users\\me\\AppData\\Roaming', 'C:\\repo'))
      .toBe('C:\\Users\\me\\AppData\\Roaming\\String-Finder\\.env');
  });
});

describe('getL10nConfigStatus', () => {
  it('reports only missing variable names and never returns values', () => {
    const status = getL10nConfigStatus('C:\\config\\.env', {
      FIGMA_API_TOKEN: 'figma-secret',
      CONFLUENCE_BASE_URL: 'https://krafton.atlassian.net',
      CONFLUENCE_EMAIL: '',
      CONFLUENCE_API_TOKEN: 'confluence-secret',
      OPENAI_API_KEY: 'openai-secret',
    });

    expect(status).toEqual({
      configured: false,
      envPath: 'C:\\config\\.env',
      missing: ['CONFLUENCE_EMAIL'],
    });
    expect(JSON.stringify(status)).not.toContain('secret');
  });
});

describe('ensureEnvFile', () => {
  it('creates a token-free template without overwriting an existing file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'string-finder-env-'));
    createdPaths.push(root);
    const envPath = path.join(root, 'nested', '.env');

    await ensureEnvFile(envPath);
    const firstContent = await readFile(envPath, 'utf8');
    expect(firstContent).toContain('FIGMA_API_TOKEN=');
    expect(firstContent).toContain('CONFLUENCE_API_TOKEN=');
    expect(firstContent).toContain('OPENAI_MODEL=gpt-5.6-terra');
    expect(firstContent).toContain('OPENAI_REASONING_EFFORT=low');
    expect(firstContent).not.toContain('secret');

    await ensureEnvFile(envPath);
    expect(await readFile(envPath, 'utf8')).toBe(firstContent);
  });
});
