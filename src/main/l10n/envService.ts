import dotenv from 'dotenv';
import { mkdir, open } from 'fs/promises';
import * as path from 'path';
import { L10nConfigStatus } from '../../shared/l10nTypes';

const REQUIRED_KEYS = [
  'FIGMA_API_TOKEN',
  'CONFLUENCE_BASE_URL',
  'CONFLUENCE_EMAIL',
  'CONFLUENCE_API_TOKEN',
  'OPENAI_API_KEY',
] as const;

const ENV_TEMPLATE = `OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini

FIGMA_API_TOKEN=

CONFLUENCE_BASE_URL=https://krafton.atlassian.net
CONFLUENCE_EMAIL=
CONFLUENCE_API_TOKEN=
`;

export function resolveEnvPath(
  isPackaged: boolean,
  appDataPath: string,
  projectRoot: string,
): string {
  return isPackaged
    ? path.join(appDataPath, 'String-Finder', '.env')
    : path.join(projectRoot, '.env');
}

export function reloadEnvironment(envPath: string): void {
  dotenv.config({ path: envPath, override: true, quiet: true });
}

export function getL10nConfigStatus(
  envPath: string,
  environment: NodeJS.ProcessEnv = process.env,
): L10nConfigStatus {
  const missing = REQUIRED_KEYS.filter((key) => !environment[key]?.trim());
  return {
    configured: missing.length === 0,
    envPath,
    missing: [...missing],
  };
}

export async function ensureEnvFile(envPath: string): Promise<string> {
  await mkdir(path.dirname(envPath), { recursive: true });

  try {
    const file = await open(envPath, 'wx');
    await file.writeFile(ENV_TEMPLATE, 'utf8');
    await file.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }

  return envPath;
}
