import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'fs/promises';
import * as path from 'path';
import { InputFileData, L10nIssue } from '../../shared/l10nTypes';
import { parseStringId, StringIdDecision } from './stringIdRules';

export interface LoadedInputFiles {
  inputRoot: string;
  files: Map<string, InputFileData>;
  raw: Map<string, string>;
}

export interface JsonFileChange {
  fileName: string;
  filePath: string;
  before: string;
  after: string;
  addedIds: string[];
}

export interface JsonChangePlan {
  files: JsonFileChange[];
  issues: L10nIssue[];
  diff: string;
}

export interface JsonApplyResult {
  backupRoot: string;
  changedFiles: string[];
  diff: string;
}

export type ReplaceFile = (source: string, target: string) => Promise<void>;

function resolveInputRoot(uiRoot: string): string {
  return path.basename(path.normalize(uiRoot)).toLowerCase() === 'input'
    ? uiRoot
    : path.join(uiRoot, 'input');
}

export async function loadInputFiles(uiRoot: string): Promise<LoadedInputFiles> {
  const inputRoot = resolveInputRoot(uiRoot);
  const entries = await readdir(inputRoot, { withFileTypes: true });
  const fileNames = entries
    .filter((entry) => entry.isFile() && /^ui_.+\.json$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const files = new Map<string, InputFileData>();
  const raw = new Map<string, string>();

  for (const fileName of fileNames) {
    const content = await readFile(path.join(inputRoot, fileName), 'utf8');
    const parsed = JSON.parse(content) as InputFileData;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error(`${fileName}의 JSON 최상위 값이 객체가 아닙니다.`);
    }
    files.set(fileName, parsed);
    raw.set(fileName, content);
  }
  return { inputRoot, files, raw };
}

function expectedFileName(feature: string): string {
  return feature === 'COMMON' ? 'ui_common.json' : `ui_${feature.toLowerCase()}.json`;
}

export function planJsonChanges(
  decisions: StringIdDecision[],
  loaded: LoadedInputFiles,
): JsonChangePlan {
  const issues: L10nIssue[] = [];
  const additionsByFile = new Map<string, StringIdDecision[]>();

  for (const decision of decisions) {
    if (decision.action === 'reuse' || decision.action === 'skip') continue;
    const parsed = parseStringId(decision.stringId);
    if (!parsed || !decision.targetFile || decision.targetFile !== expectedFileName(parsed.feature)) {
      issues.push({
        code: 'STRING_ID_INVALID',
        rowKey: decision.rowKey,
        message: `${decision.stringId || '(빈 값)'}을 JSON 대상 파일과 연결할 수 없습니다.`,
      });
      continue;
    }
    const targetData = loaded.files.get(decision.targetFile);
    if (!targetData) {
      issues.push({
        code: 'TARGET_FILE_MISSING',
        rowKey: decision.rowKey,
        message: `${decision.targetFile} 파일을 찾을 수 없습니다.`,
      });
      continue;
    }

    const existing = targetData[decision.stringId];
    if (existing) {
      if (existing.Text !== decision.english) {
        issues.push({
          code: 'STRING_ID_INVALID',
          rowKey: decision.rowKey,
          message: `${decision.stringId}가 다른 영문으로 이미 존재합니다.`,
        });
      }
      continue;
    }

    const additions = additionsByFile.get(decision.targetFile) ?? [];
    const duplicate = additions.find((item) => item.stringId === decision.stringId);
    if (duplicate) {
      if (duplicate.english !== decision.english) {
        issues.push({
          code: 'STRING_ID_INVALID',
          rowKey: decision.rowKey,
          message: `${decision.stringId}가 위키 안에서 서로 다른 영문에 사용되었습니다.`,
        });
      }
      continue;
    }
    additions.push(decision);
    additionsByFile.set(decision.targetFile, additions);
  }

  const files: JsonFileChange[] = [];
  for (const [fileName, additions] of [...additionsByFile].sort(([a], [b]) => a.localeCompare(b))) {
    const original = loaded.files.get(fileName)!;
    const next: InputFileData = { ...original };
    additions.sort((a, b) => a.stringId.localeCompare(b.stringId)).forEach((addition) => {
      next[addition.stringId] = {
        Text: addition.english,
        ReleaseDate: addition.releaseDate,
      };
    });
    const before = loaded.raw.get(fileName) ?? `${JSON.stringify(original, null, 4)}\n`;
    files.push({
      fileName,
      filePath: path.join(loaded.inputRoot, fileName),
      before,
      after: `${JSON.stringify(next, null, 4)}\n`,
      addedIds: additions.map((addition) => addition.stringId),
    });
  }

  const diff = files.flatMap((file) => [
    `--- ${file.fileName}`,
    `+++ ${file.fileName}`,
    ...file.addedIds.map((stringId) => `+ ${stringId}`),
  ]).join('\n');
  return { files, issues, diff };
}

const defaultReplace: ReplaceFile = async (source, target) => {
  await copyFile(source, target);
};

export async function applyJsonChanges(
  plan: JsonChangePlan,
  backupRoot: string,
  replaceFile: ReplaceFile = defaultReplace,
): Promise<JsonApplyResult> {
  if (plan.files.length === 0) {
    return { backupRoot, changedFiles: [], diff: plan.diff };
  }

  await mkdir(backupRoot, { recursive: true });
  const temporaryFiles: string[] = [];
  const replaced: JsonFileChange[] = [];
  try {
    for (const file of plan.files) {
      const temporaryPath = `${file.filePath}.string-finder-${process.pid}-${Date.now()}.tmp`;
      await writeFile(temporaryPath, file.after, 'utf8');
      JSON.parse(await readFile(temporaryPath, 'utf8'));
      temporaryFiles.push(temporaryPath);
      await copyFile(file.filePath, path.join(backupRoot, file.fileName));
    }

    for (let index = 0; index < plan.files.length; index += 1) {
      const file = plan.files[index];
      await replaceFile(temporaryFiles[index], file.filePath);
      replaced.push(file);
    }
  } catch (error) {
    for (const file of replaced.reverse()) {
      await copyFile(path.join(backupRoot, file.fileName), file.filePath);
    }
    throw error;
  } finally {
    await Promise.all(temporaryFiles.map((temporaryPath) => rm(temporaryPath, { force: true })));
  }

  return {
    backupRoot,
    changedFiles: plan.files.map((file) => file.filePath),
    diff: plan.diff,
  };
}
