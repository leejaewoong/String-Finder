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
  applyFigmaSourceUpdates,
  applyStringIdUpdates,
  compareWikiRows,
  createL10nTable,
  createL10nSyncMetadata,
  EXISTING_STRING_ID_NOTE,
  findL10nTable,
  L10N_SYNC_PROPERTY_KEY,
  L10nSyncMetadata,
  MatchedWikiString,
  normalizeL10nSyncMetadata,
} from './confluenceTable';
import { FigmaScannedFrame, FigmaScanResult } from './figmaClient';
import { buildFeatureCatalog, featureTargetMap } from './featureCatalog';
import { applyJsonChanges, loadInputFiles, planJsonChanges } from './jsonRepository';
import { L10nInferenceResult, L10nInferenceRow } from './l10nOpenAiClient';
import { resolveReleaseDate } from './releaseDate';
import {
  buildStringIndex,
  decideStringIds,
  findStringIdCollisions,
  findStringIdTypeIssues,
  StringIdDecision,
  StringIdRow,
} from './stringIdRules';
import {
  emptyL10nTaskState,
  prepareL10nTaskStateForInput,
} from './l10nTaskState';
import { cloneL10nInput } from '../../shared/l10nSession';

interface FigmaGateway {
  scan(urls: string[], signal?: AbortSignal): Promise<FigmaScanResult>;
  exportFrame(fileKey: string, frameId: string, outputPath: string, signal?: AbortSignal): Promise<void>;
}

interface ConfluenceGateway {
  getPage(pageId: string, signal?: AbortSignal): Promise<ConfluencePage>;
  updatePage(pageId: string, storage: string, expectedVersion: number, signal?: AbortSignal): Promise<ConfluencePage>;
  setPageFullWidth(pageId: string, signal?: AbortSignal): Promise<void>;
  uploadAttachment(pageId: string, filePath: string, fileName: string, signal?: AbortSignal): Promise<void>;
  getChildPages(parentPageId: string, signal?: AbortSignal): Promise<ConfluenceChildPage[]>;
  getContentProperty<T>(
    pageId: string,
    key: string,
    signal?: AbortSignal,
  ): Promise<{ value: T; version: number } | undefined>;
  setContentProperty(
    pageId: string,
    key: string,
    value: unknown,
    currentVersion?: number,
    signal?: AbortSignal,
  ): Promise<void>;
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
  return emptyL10nTaskState();
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
    || error instanceof Error && error.name === 'AbortError';
}

function uniqueIssues(issues: L10nIssue[]): L10nIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}\u0000${issue.rowKey ?? ''}\u0000${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
    existingStringId: row.stringId || undefined,
    tagLabel: row.label,
    layerPath: row.layerPath,
    layerTypes: row.layerTypes,
    screenContext: row.screenContext,
  }));
}

function stringIdUpdates(decisions: StringIdDecision[]) {
  return decisions
    .filter((decision) => decision.action !== 'skip')
    .map((decision) => ({
      rowKey: decision.rowKey,
      stringId: decision.stringId,
      note: decision.action === 'reuse' ? EXISTING_STRING_ID_NOTE : '',
    }));
}

export class L10nOrchestrator {
  private state: L10nTaskState;
  private listeners = new Set<StateListener>();
  private controller?: AbortController;
  private runId = 0;
  private readonly now: () => Date;

  constructor(
    private readonly dependencies: L10nOrchestratorDependencies,
    initialState: L10nTaskState = idleState(),
  ) {
    this.now = dependencies.now ?? (() => new Date());
    this.state = {
      ...initialState,
      ...(initialState.activeInput
        ? { activeInput: cloneL10nInput(initialState.activeInput) }
        : {}),
      issues: initialState.issues.map((issue) => ({ ...issue })),
      stats: { ...initialState.stats },
    };
  }

  getState(): L10nTaskState {
    return {
      ...this.state,
      ...(this.state.activeInput
        ? { activeInput: cloneL10nInput(this.state.activeInput) }
        : {}),
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
    this.reset();
  }

  reset(): void {
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
    this.state = prepareL10nTaskStateForInput(this.state, input);
    return this.run(async (runId, signal) => {
      this.setProgress('figma-scanning', 'STRING ID 생성 중');
      const [figma, page] = await Promise.all([
        this.dependencies.figma.scan(input.figmaUrls, signal),
        this.dependencies.confluence.getPage(parseConfluencePageUrl(input.wikiUrl), signal),
      ]);
      this.assertActive(runId);
      this.setState({ ...this.state, taskTitle: page.title });
      const table = findL10nTable(page.storage);
      const syncProperty = await this.dependencies.confluence.getContentProperty<L10nSyncMetadata>(
        page.id,
        L10N_SYNC_PROPERTY_KEY,
        signal,
      );

      if (!table) {
        return this.createWikiTable(input, page, figma, syncProperty, runId, signal);
      }
      return this.generateIds(input, page, figma, syncProperty, runId, signal);
    });
  }

  async finalize(input: L10nInput): Promise<L10nRunResult> {
    this.validateInput(input);
    this.state = prepareL10nTaskStateForInput(this.state, input);
    return this.run(async (runId, signal) => {
      this.setProgress('figma-scanning', 'JSON 반영 중');
      const [figma, page] = await Promise.all([
        this.dependencies.figma.scan(input.figmaUrls, signal),
        this.dependencies.confluence.getPage(parseConfluencePageUrl(input.wikiUrl), signal),
      ]);
      this.assertActive(runId);
      this.setState({ ...this.state, taskTitle: page.title });
      const originalTable = findL10nTable(page.storage);
      if (!originalTable) throw new Error('최종 확정할 L10N 표를 찾을 수 없습니다.');
      const syncProperty = await this.dependencies.confluence.getContentProperty<L10nSyncMetadata>(
        page.id,
        L10N_SYNC_PROPERTY_KEY,
        signal,
      );
      const currentMetadata = normalizeL10nSyncMetadata(syncProperty?.value);
      const sourceUpdate = applyFigmaSourceUpdates(page.storage, figma.frames, currentMetadata);
      if (figma.frames.length > 0) {
        await this.refreshFrameAttachments(page.id, figma.frames, runId, signal);
      }
      const table = findL10nTable(sourceUpdate.storage)!;
      const { rows, issues } = this.validRows(table, figma, sourceUpdate.metadata);
      const loaded = await loadInputFiles(this.dependencies.uiRoot);
      const targetFiles = featureTargetMap(buildFeatureCatalog(loaded.files));
      const stringIndex = buildStringIndex(loaded.files, loaded.koreanById);
      const activeRowKeys = new Set(rows.map((row) => row.rowKey));
      const reservedRows: StringIdRow[] = table.rows
        .filter((row) => !activeRowKeys.has(row.rowKey))
        .map((row) => ({
          rowKey: row.rowKey,
          korean: row.korean,
          english: row.english,
          stringId: row.stringId,
        }));
      const inferred = await this.dependencies.openAi.infer(
        inferenceRows(rows),
        [input.featurePrefix.trim().toUpperCase()],
        signal,
      );
      const decisions = decideStringIds(
        rows.map((row) => ({
          rowKey: row.rowKey,
          korean: row.korean,
          english: row.english,
          stringId: row.stringId,
        })),
        inferred.inferences,
        stringIndex,
        input.releaseDate,
        targetFiles,
        reservedRows,
      );
      const allIssues = uniqueIssues([
        ...figma.issues,
        ...sourceUpdate.issues,
        ...issues,
        ...inferred.issues,
        ...findStringIdTypeIssues(rows, inferred.inferences),
      ]);
      const updatedStorage = applyStringIdUpdates(
        sourceUpdate.storage,
        stringIdUpdates(decisions),
      );
      const updatedTable = findL10nTable(updatedStorage)!;
      allIssues.push(...findStringIdCollisions(
        updatedTable.rows.map((row) => ({
          rowKey: row.rowKey,
          korean: row.korean,
          english: row.english,
          stringId: row.stringId,
        })),
        stringIndex,
      ));
      if (updatedStorage !== page.storage) {
        this.assertActive(runId);
        await this.dependencies.confluence.updatePage(page.id, updatedStorage, page.version, signal);
      }
      if (JSON.stringify(currentMetadata) !== JSON.stringify(sourceUpdate.metadata)) {
        this.assertActive(runId);
        await this.dependencies.confluence.setContentProperty(
          page.id,
          L10N_SYNC_PROPERTY_KEY,
          sourceUpdate.metadata,
          syncProperty?.version,
          signal,
        );
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
        label: '작업 완료',
        taskTitle: page.title,
        activeInput: cloneL10nInput(input),
        attentionCount: allIssues.length,
        issues: allIssues,
        stats,
        lastGeneratedAt: this.now().toISOString(),
        canGenerate: false,
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
    syncProperty: { value: L10nSyncMetadata; version: number } | undefined,
    runId: number,
    signal: AbortSignal,
  ): Promise<L10nRunResult> {
    this.setProgress('table-creating', '위키 작성 중');
    await mkdir(this.dependencies.tempRoot, { recursive: true });
    const taskRoot = await mkdtemp(path.join(this.dependencies.tempRoot, 'l10n-'));
    let decisions: StringIdDecision[] = [];
    let allIssues: L10nIssue[] = [...figma.issues];
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
      let storage = createL10nTable(page.storage, figma.frames);
      const table = findL10nTable(storage)!;
      const { rows, issues } = this.validRows(table, figma);
      const loaded = await loadInputFiles(this.dependencies.uiRoot);
      const targetFiles = featureTargetMap(buildFeatureCatalog(loaded.files));
      this.setProgress('id-generating', 'STRING ID 생성 중');
      const inferred = await this.dependencies.openAi.infer(
        inferenceRows(rows),
        [input.featurePrefix.trim().toUpperCase()],
        signal,
      );
      decisions = decideStringIds(
        rows.map((row) => ({
          rowKey: row.rowKey,
          korean: row.korean,
          english: row.english,
          stringId: row.stringId,
        })),
        inferred.inferences,
        buildStringIndex(loaded.files, loaded.koreanById),
        input.releaseDate,
        targetFiles,
      );
      allIssues = [
        ...figma.issues,
        ...issues,
        ...inferred.issues,
        ...findStringIdTypeIssues(rows, inferred.inferences),
      ];
      storage = applyStringIdUpdates(storage, stringIdUpdates(decisions));
      const updatedTable = findL10nTable(storage)!;
      allIssues.push(...findStringIdCollisions(
        updatedTable.rows.map((row) => ({
          rowKey: row.rowKey,
          korean: row.korean,
          english: row.english,
          stringId: row.stringId,
        })),
        buildStringIndex(loaded.files, loaded.koreanById),
      ));
      this.assertActive(runId);
      await this.dependencies.confluence.setPageFullWidth(page.id, signal);
      this.assertActive(runId);
      await this.dependencies.confluence.updatePage(page.id, storage, page.version, signal);
      this.assertActive(runId);
      await this.dependencies.confluence.setContentProperty(
        page.id,
        L10N_SYNC_PROPERTY_KEY,
        createL10nSyncMetadata(figma.frames),
        syncProperty?.version,
        signal,
      );
    } finally {
      await rm(taskRoot, { recursive: true, force: true });
    }

    const total = figma.frames.reduce((count, frame) => count + frame.strings.length, 0);
    this.setState({
      stage: 'english-review',
      label: '영문 검수 대기중',
      taskTitle: page.title,
      activeInput: cloneL10nInput(input),
      attentionCount: allIssues.length,
      issues: allIssues,
      stats: decisionStats(total, decisions, allIssues.length),
      lastGeneratedAt: this.now().toISOString(),
      canGenerate: true,
      canFinalize: false,
      canCancel: true,
    });
    return { state: this.getState(), pageUrl: input.wikiUrl };
  }

  private async generateIds(
    input: L10nInput,
    page: ConfluencePage,
    figma: FigmaScanResult,
    syncProperty: { value: L10nSyncMetadata; version: number } | undefined,
    runId: number,
    signal: AbortSignal,
  ): Promise<L10nRunResult> {
    this.setProgress('id-generating', 'STRING ID 생성 중');
    const currentMetadata = normalizeL10nSyncMetadata(syncProperty?.value);
    const sourceUpdate = applyFigmaSourceUpdates(page.storage, figma.frames, currentMetadata);
    if (figma.frames.length > 0) {
      this.setProgress('table-creating', '위키 작성 중');
      await this.refreshFrameAttachments(page.id, figma.frames, runId, signal);
      this.setProgress('id-generating', 'STRING ID 생성 중');
    }
    const table = findL10nTable(sourceUpdate.storage)!;
    const { rows, issues } = this.validRows(table, figma, sourceUpdate.metadata);
    const rowsForIdGeneration = rows.filter((row) =>
      !sourceUpdate.preservedStringIdRowKeys.has(row.rowKey));
    const loaded = await loadInputFiles(this.dependencies.uiRoot);
    const targetFiles = featureTargetMap(buildFeatureCatalog(loaded.files));
    const stringIndex = buildStringIndex(loaded.files, loaded.koreanById);
    const activeRowKeys = new Set(rows.map((row) => row.rowKey));
    const reservedRows: StringIdRow[] = table.rows
      .filter((row) => !activeRowKeys.has(row.rowKey))
      .map((row) => ({
        rowKey: row.rowKey,
        korean: row.korean,
        english: row.english,
        stringId: row.stringId,
      }));
    const inferred = rowsForIdGeneration.length > 0
      ? await this.dependencies.openAi.infer(
        inferenceRows(rowsForIdGeneration),
        [input.featurePrefix.trim().toUpperCase()],
        signal,
      )
      : { inferences: [], issues: [] };
    const decisions = decideStringIds(
      rowsForIdGeneration.map((row) => ({
        rowKey: row.rowKey,
        korean: row.korean,
        english: row.english,
        stringId: row.stringId,
      })),
      inferred.inferences,
      stringIndex,
      input.releaseDate,
      targetFiles,
      reservedRows,
    );
    const allIssues = uniqueIssues([
      ...figma.issues,
      ...sourceUpdate.issues,
      ...issues,
      ...inferred.issues,
      ...findStringIdTypeIssues(rowsForIdGeneration, inferred.inferences),
    ]);
    const storage = applyStringIdUpdates(sourceUpdate.storage, stringIdUpdates(decisions));
    const updatedTable = findL10nTable(storage)!;
    allIssues.push(...findStringIdCollisions(
      updatedTable.rows.map((row) => ({
        rowKey: row.rowKey,
        korean: row.korean,
        english: row.english,
        stringId: row.stringId,
      })),
      stringIndex,
    ));
    if (storage !== page.storage) {
      this.assertActive(runId);
      await this.dependencies.confluence.updatePage(page.id, storage, page.version, signal);
    }
    const metadataChanged = JSON.stringify(currentMetadata) !== JSON.stringify(sourceUpdate.metadata);
    if (metadataChanged) {
      this.assertActive(runId);
      await this.dependencies.confluence.setContentProperty(
        page.id,
        L10N_SYNC_PROPERTY_KEY,
        sourceUpdate.metadata,
        syncProperty?.version,
        signal,
      );
    }

    const hasGeneratedIds = decisions.some((decision) => decision.action !== 'skip')
      || rows.some((row) =>
        sourceUpdate.preservedStringIdRowKeys.has(row.rowKey) && Boolean(row.stringId.trim()));
    const hasMissingEnglish = rows.some((row) => !row.english.trim());
    this.setState({
      stage: hasMissingEnglish || !hasGeneratedIds ? 'english-review' : 'wiki-review',
      label: hasMissingEnglish || !hasGeneratedIds ? '영문 검수 대기중' : 'STRING ID 검토 중',
      taskTitle: page.title,
      activeInput: cloneL10nInput(input),
      attentionCount: allIssues.length,
      issues: allIssues,
      stats: decisionStats(table.rows.length, decisions, allIssues.length),
      lastGeneratedAt: this.now().toISOString(),
      canGenerate: true,
      canFinalize: hasGeneratedIds && !hasMissingEnglish,
      canCancel: true,
    });
    return { state: this.getState(), pageUrl: input.wikiUrl };
  }

  private async refreshFrameAttachments(
    pageId: string,
    frames: FigmaScannedFrame[],
    runId: number,
    signal: AbortSignal,
  ): Promise<void> {
    await mkdir(this.dependencies.tempRoot, { recursive: true });
    const taskRoot = await mkdtemp(path.join(this.dependencies.tempRoot, 'l10n-refresh-'));
    try {
      for (const frame of frames) {
        const outputPath = path.join(taskRoot, frame.attachmentName);
        await this.dependencies.figma.exportFrame(frame.fileKey, frame.id, outputPath, signal);
        this.assertActive(runId);
        await this.dependencies.confluence.uploadAttachment(
          pageId,
          outputPath,
          frame.attachmentName,
          signal,
        );
      }
    } finally {
      await rm(taskRoot, { recursive: true, force: true });
    }
  }

  private validRows(
    table: NonNullable<ReturnType<typeof findL10nTable>>,
    figma: FigmaScanResult,
    metadata?: L10nSyncMetadata,
  ): { rows: MatchedWikiString[]; issues: L10nIssue[] } {
    const compared = compareWikiRows(table, figma.frames, metadata);
    const issues = [...compared.issues];
    for (const row of compared.matched) {
      if (!row.english.trim()) issues.push({
        code: 'ENGLISH_MISSING',
        rowKey: row.rowKey,
        delimiter: row.delimiter,
        frameName: row.frame.name,
        korean: row.korean,
        message: `구분자 ${row.delimiter}의 영문이 비어 있습니다.`,
      });
    }
    return { rows: compared.matched, issues };
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
        taskTitle: this.state.taskTitle,
        activeInput: this.state.activeInput,
        error: message,
        canCancel: Boolean(this.state.taskTitle),
      });
      return { state: this.getState() };
    } finally {
      if (this.controller === controller) this.controller = undefined;
    }
  }

  private validateInput(input: L10nInput): void {
    if (!input.wikiUrl.trim()) throw new Error('위키 페이지 URL을 입력해 주세요.');
    if (!input.figmaUrls.some((url) => url.trim())) throw new Error('Figma URL을 하나 이상 입력해 주세요.');
    if (!/^[A-Z0-9_]+$/.test(input.featurePrefix.trim().toUpperCase())) {
      throw new Error('Feature Prefix는 영문 대문자, 숫자, 밑줄만 입력해 주세요.');
    }
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
