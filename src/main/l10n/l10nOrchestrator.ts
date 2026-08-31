import { mkdir, mkdtemp, rm } from 'fs/promises';
import * as path from 'path';
import {
  L10nInput,
  L10nIssue,
  L10nRunResult,
  L10nStats,
  L10nTaskState,
  ReleaseDateSuggestion,
} from '../../shared/l10nTypes';
import { ConfluenceChildPage, ConfluencePage, parseConfluencePageUrl } from './confluenceClient';
import {
  applyStringIdUpdates,
  compareWikiRows,
  createL10nTable,
  findL10nTable,
  MatchedWikiString,
} from './confluenceTable';
import { FigmaScanResult } from './figmaClient';
import { applyJsonChanges, loadInputFiles, planJsonChanges } from './jsonRepository';
import { L10nInferenceResult, L10nInferenceRow } from './l10nOpenAiClient';
import { resolveReleaseDate } from './releaseDate';
import { buildStringIndex, decideStringIds, StringIdDecision } from './stringIdRules';

interface FigmaGateway {
  scan(urls: string[], signal?: AbortSignal): Promise<FigmaScanResult>;
  exportFrame(fileKey: string, frameId: string, outputPath: string, signal?: AbortSignal): Promise<void>;
}

interface ConfluenceGateway {
  getPage(pageId: string, signal?: AbortSignal): Promise<ConfluencePage>;
  updatePage(pageId: string, storage: string, expectedVersion: number, signal?: AbortSignal): Promise<ConfluencePage>;
  uploadAttachment(pageId: string, filePath: string, fileName: string, signal?: AbortSignal): Promise<void>;
  getChildPages(parentPageId: string, signal?: AbortSignal): Promise<ConfluenceChildPage[]>;
}

interface OpenAiGateway {
  infer(rows: L10nInferenceRow[], featureCandidates: string[], signal?: AbortSignal): Promise<L10nInferenceResult>;
}

export interface L10nOrchestratorDependencies {
  figma: FigmaGateway;
  confluence: ConfluenceGateway;
  openAi: OpenAiGateway;
  uiRoot: string;
  appDataPath: string;
  tempRoot: string;
  now?: () => Date;
}

type StateListener = (state: L10nTaskState) => void;

const EMPTY_STATS: L10nStats = {
  total: 0,
  matched: 0,
  reused: 0,
  created: 0,
  common: 0,
  renumbered: 0,
  skipped: 0,
};

function idleState(): L10nTaskState {
  return {
    stage: 'idle',
    label: '대기 중',
    attentionCount: 0,
    issues: [],
    stats: { ...EMPTY_STATS },
    canGenerate: true,
    canFinalize: false,
    canCancel: false,
  };
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
    || error instanceof Error && error.name === 'AbortError';
}

function featureCandidates(fileNames: Iterable<string>): string[] {
  return [...fileNames]
    .filter((fileName) => /^ui_.+\.json$/i.test(fileName) && fileName.toLowerCase() !== 'ui_common.json')
    .map((fileName) => fileName.replace(/^ui_|\.json$/gi, '').toUpperCase())
    .sort();
}

function decisionStats(total: number, decisions: StringIdDecision[], issueCount: number): L10nStats {
  return {
    total,
    matched: decisions.filter((decision) => decision.action !== 'skip').length,
    reused: decisions.filter((decision) => decision.action === 'reuse').length,
    created: decisions.filter((decision) => decision.action === 'create').length,
    common: decisions.filter((decision) => decision.stringId.startsWith('COMMON:')).length,
    renumbered: decisions.filter((decision) => decision.action === 'renumber').length,
    skipped: decisions.filter((decision) => decision.action === 'skip').length + issueCount,
  };
}

function inferenceRows(rows: MatchedWikiString[]): L10nInferenceRow[] {
  return rows.map((row) => ({
    rowKey: row.rowKey,
    korean: row.korean,
    english: row.english,
    frameName: row.frame.name,
    idHint: row.stringIdHint,
  }));
}

export class L10nOrchestrator {
  private state = idleState();
  private listeners = new Set<StateListener>();
  private controller?: AbortController;
  private runId = 0;
  private readonly now: () => Date;

  constructor(private readonly dependencies: L10nOrchestratorDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  getState(): L10nTaskState {
    return {
      ...this.state,
      issues: this.state.issues.map((issue) => ({ ...issue })),
      stats: { ...this.state.stats },
    };
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  cancel(): void {
    if (!this.state.canCancel || this.state.stage === 'json-applying') return;
    this.runId += 1;
    this.controller?.abort();
    this.controller = undefined;
    this.setState(idleState());
  }

  async suggestReleaseDate(
    wikiUrl: string,
    figmaUrls: string[],
  ): Promise<ReleaseDateSuggestion> {
    const controller = new AbortController();
    const wikiPage = wikiUrl.trim()
      ? await this.dependencies.confluence.getPage(parseConfluencePageUrl(wikiUrl), controller.signal)
      : undefined;
    const figma = figmaUrls.some((url) => url.trim())
      ? await this.dependencies.figma.scan(figmaUrls.filter((url) => url.trim()), controller.signal)
      : undefined;
    return resolveReleaseDate(
      wikiPage?.title,
      figma?.fileTitles ?? [],
      this.dependencies.confluence,
      controller.signal,
    );
  }

  async generate(input: L10nInput): Promise<L10nRunResult> {
    this.validateInput(input);
    return this.run(async (runId, signal) => {
      this.setProgress('figma-scanning', 'Figma와 위키 확인 중');
      const [figma, page] = await Promise.all([
        this.dependencies.figma.scan(input.figmaUrls, signal),
        this.dependencies.confluence.getPage(parseConfluencePageUrl(input.wikiUrl), signal),
      ]);
      this.assertActive(runId);
      const table = findL10nTable(page.storage);

      if (!table) {
        return this.createWikiTable(input, page, figma, runId, signal);
      }
      return this.generateIds(input, page, figma, runId, signal);
    });
  }

  async finalize(input: L10nInput): Promise<L10nRunResult> {
    this.validateInput(input);
    return this.run(async (runId, signal) => {
      this.setProgress('figma-scanning', '최신 위키와 Figma 다시 확인 중');
      const [figma, page] = await Promise.all([
        this.dependencies.figma.scan(input.figmaUrls, signal),
        this.dependencies.confluence.getPage(parseConfluencePageUrl(input.wikiUrl), signal),
      ]);
      this.assertActive(runId);
      const table = findL10nTable(page.storage);
      if (!table) throw new Error('최종 확정할 L10N 표를 찾을 수 없습니다.');

      const { rows, issues } = this.validRows(table, figma);
      const loaded = await loadInputFiles(this.dependencies.uiRoot);
      const inferred = await this.dependencies.openAi.infer(
        inferenceRows(rows),
        featureCandidates(loaded.files.keys()),
        signal,
      );
      const decisions = decideStringIds(
        rows.map((row) => ({ rowKey: row.rowKey, english: row.english, stringId: row.stringId })),
        inferred.inferences,
        buildStringIndex(loaded.files),
        input.releaseDate,
      );
      const allIssues = [...figma.issues, ...issues, ...inferred.issues];
      const updatedStorage = applyStringIdUpdates(page.storage, decisions
        .filter((decision) => decision.action !== 'skip')
        .map((decision) => ({ rowKey: decision.rowKey, stringId: decision.stringId })));
      if (updatedStorage !== page.storage) {
        this.assertActive(runId);
        await this.dependencies.confluence.updatePage(page.id, updatedStorage, page.version, signal);
      }

      const plan = planJsonChanges(decisions, loaded);
      allIssues.push(...plan.issues);
      this.assertActive(runId);
      this.setState({
        ...this.state,
        stage: 'json-applying',
        label: 'JSON 반영 중',
        canGenerate: false,
        canFinalize: false,
        canCancel: false,
      });
      const taskId = this.now().toISOString().replace(/[:.]/g, '-');
      const backupRoot = path.join(
        this.dependencies.appDataPath,
        'String-Finder',
        'backups',
        taskId,
      );
      const applied = await applyJsonChanges(plan, backupRoot);
      const stats = decisionStats(table.rows.length, decisions, allIssues.length);
      this.setState({
        stage: 'complete',
        label: 'JSON 반영 완료',
        attentionCount: allIssues.length,
        issues: allIssues,
        stats,
        lastGeneratedAt: this.now().toISOString(),
        canGenerate: true,
        canFinalize: false,
        canCancel: false,
      });
      return { state: this.getState(), pageUrl: input.wikiUrl, diff: applied.diff };
    });
  }

  private async createWikiTable(
    input: L10nInput,
    page: ConfluencePage,
    figma: FigmaScanResult,
    runId: number,
    signal: AbortSignal,
  ): Promise<L10nRunResult> {
    this.setProgress('table-creating', '위키 표와 프레임 이미지 생성 중');
    await mkdir(this.dependencies.tempRoot, { recursive: true });
    const taskRoot = await mkdtemp(path.join(this.dependencies.tempRoot, 'l10n-'));
    try {
      for (const frame of figma.frames) {
        const outputPath = path.join(taskRoot, frame.attachmentName);
        await this.dependencies.figma.exportFrame(frame.fileKey, frame.id, outputPath, signal);
        this.assertActive(runId);
        await this.dependencies.confluence.uploadAttachment(
          page.id,
          outputPath,
          frame.attachmentName,
          signal,
        );
      }
      const storage = createL10nTable(page.storage, figma.frames);
      this.assertActive(runId);
      await this.dependencies.confluence.updatePage(page.id, storage, page.version, signal);
    } finally {
      await rm(taskRoot, { recursive: true, force: true });
    }

    const total = figma.frames.reduce((count, frame) => count + frame.strings.length, 0);
    this.setState({
      stage: 'english-review',
      label: '영문 검수 대기',
      attentionCount: figma.issues.length,
      issues: figma.issues,
      stats: { ...EMPTY_STATS, total, skipped: figma.issues.length },
      lastGeneratedAt: this.now().toISOString(),
      canGenerate: true,
      canFinalize: false,
      canCancel: false,
    });
    return { state: this.getState(), pageUrl: input.wikiUrl };
  }

  private async generateIds(
    input: L10nInput,
    page: ConfluencePage,
    figma: FigmaScanResult,
    runId: number,
    signal: AbortSignal,
  ): Promise<L10nRunResult> {
    this.setProgress('id-generating', 'String ID 생성 중');
    const table = findL10nTable(page.storage)!;
    const { rows, issues } = this.validRows(table, figma);
    const loaded = await loadInputFiles(this.dependencies.uiRoot);
    const inferred = await this.dependencies.openAi.infer(
      inferenceRows(rows),
      featureCandidates(loaded.files.keys()),
      signal,
    );
    const decisions = decideStringIds(
      rows.map((row) => ({ rowKey: row.rowKey, english: row.english, stringId: row.stringId })),
      inferred.inferences,
      buildStringIndex(loaded.files),
      input.releaseDate,
    );
    const allIssues = [...figma.issues, ...issues, ...inferred.issues];
    const storage = applyStringIdUpdates(page.storage, decisions
      .filter((decision) => decision.action !== 'skip')
      .map((decision) => ({ rowKey: decision.rowKey, stringId: decision.stringId })));
    if (storage !== page.storage) {
      this.assertActive(runId);
      await this.dependencies.confluence.updatePage(page.id, storage, page.version, signal);
    }

    const hasGeneratedIds = decisions.some((decision) => decision.action !== 'skip');
    this.setState({
      stage: hasGeneratedIds ? 'wiki-review' : 'english-review',
      label: hasGeneratedIds ? '위키 String ID 검토 대기' : '영문 검수 대기',
      attentionCount: allIssues.length,
      issues: allIssues,
      stats: decisionStats(table.rows.length, decisions, allIssues.length),
      lastGeneratedAt: this.now().toISOString(),
      canGenerate: true,
      canFinalize: hasGeneratedIds,
      canCancel: false,
    });
    return { state: this.getState(), pageUrl: input.wikiUrl };
  }

  private validRows(
    table: NonNullable<ReturnType<typeof findL10nTable>>,
    figma: FigmaScanResult,
  ): { rows: MatchedWikiString[]; issues: L10nIssue[] } {
    const compared = compareWikiRows(table, figma.frames);
    const issues = [...compared.issues];
    const rows = compared.matched.filter((row) => {
      if (row.english.trim()) return true;
      issues.push({
        code: 'ENGLISH_MISSING',
        rowKey: row.rowKey,
        delimiter: row.delimiter,
        frameName: row.frame.name,
        message: `구분자 ${row.delimiter}의 영문이 비어 있습니다.`,
      });
      return false;
    });
    return { rows, issues };
  }

  private async run(
    operation: (runId: number, signal: AbortSignal) => Promise<L10nRunResult>,
  ): Promise<L10nRunResult> {
    if (this.controller) throw new Error('이미 L10N 작업이 진행 중입니다.');
    const controller = new AbortController();
    this.controller = controller;
    const runId = ++this.runId;
    try {
      return await operation(runId, controller.signal);
    } catch (error) {
      if (isAbort(error) || runId !== this.runId) {
        return { state: this.getState() };
      }
      const message = error instanceof Error ? error.message : String(error);
      this.setState({
        ...idleState(),
        stage: 'error',
        label: '작업 실패',
        error: message,
      });
      return { state: this.getState() };
    } finally {
      if (this.controller === controller) this.controller = undefined;
    }
  }

  private validateInput(input: L10nInput): void {
    if (!input.wikiUrl.trim()) throw new Error('위키 페이지 URL을 입력해 주세요.');
    if (!input.figmaUrls.some((url) => url.trim())) throw new Error('Figma URL을 하나 이상 입력해 주세요.');
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(input.releaseDate)) {
      throw new Error('Release Date를 YYYY-MM-DD 형식으로 입력해 주세요.');
    }
    if (!this.dependencies.uiRoot) throw new Error('GDD UI 폴더 경로가 설정되지 않았습니다.');
  }

  private setProgress(stage: L10nTaskState['stage'], label: string): void {
    this.setState({
      ...this.state,
      stage,
      label,
      error: undefined,
      canGenerate: false,
      canFinalize: false,
      canCancel: true,
    });
  }

  private assertActive(runId: number): void {
    if (runId !== this.runId || this.controller?.signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
  }

  private setState(state: L10nTaskState): void {
    this.state = state;
    const snapshot = this.getState();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}
