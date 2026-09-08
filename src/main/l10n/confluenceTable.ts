import { load, type CheerioAPI, type HTMLParser2Options } from 'cheerio';
import { L10nIssue } from '../../shared/l10nTypes';
import { FigmaScannedFrame } from './figmaClient';
import { FigmaTaggedString } from './figmaTag';

export interface L10nTableColumns {
  delimiter?: number;
  image?: number;
  korean: number;
  english: number;
  stringId?: number;
  note?: number;
}

export interface WikiStringRow {
  rowKey: string;
  rowIndex: number;
  frameGroup: number;
  delimiter: string;
  korean: string;
  english: string;
  stringId: string;
  note: string;
}

export interface L10nTable {
  tableIndex: number;
  columns: L10nTableColumns;
  rows: WikiStringRow[];
  hasStringIdColumn: boolean;
}

export interface StringIdUpdate {
  rowKey: string;
  stringId: string;
  note?: string;
}

export interface MatchedWikiString extends FigmaTaggedString {
  rowKey: string;
  english: string;
  stringId: string;
}

export interface WikiComparisonResult {
  matched: MatchedWikiString[];
  issues: L10nIssue[];
}

export interface FigmaSourceUpdateResult {
  storage: string;
  changedFrames: FigmaScannedFrame[];
  preservedStringIdRowKeys: Set<string>;
  metadata: L10nSyncMetadata;
  issues: L10nIssue[];
}

export interface L10nSyncRowMetadata {
  fileKey: string;
  frameId: string;
  targetNodeId: string;
  tagNodeId: string;
  delimiter: string;
}

export interface L10nSyncFrameMetadata {
  fileKey: string;
  frameId: string;
  attachmentName: string;
}

export interface L10nSyncMetadata {
  schemaVersion: 1;
  rows: L10nSyncRowMetadata[];
  frames: L10nSyncFrameMetadata[];
}

type CheerioNode = ReturnType<CheerioAPI>[number];

const XML_OPTIONS: HTMLParser2Options = { xmlMode: true, decodeEntities: false };

interface GridCell {
  element: CheerioNode;
  originRow: number;
}

interface ParsedTable extends L10nTable {
  tableElement: CheerioNode;
  dataRows: CheerioNode[];
  grids: GridCell[][];
  headerRowIndex: number;
}

interface LocatedFigmaTag {
  tag: FigmaTaggedString;
  frame: FigmaScannedFrame;
}

interface FigmaTagLookup {
  byFrameAndDelimiter: Map<string, LocatedFigmaTag>;
  byDelimiter: Map<string, LocatedFigmaTag[]>;
}

interface ReconciledRow {
  node: CheerioNode;
  metadata: L10nSyncRowMetadata;
  originalFrameGroup: number;
  originalOrder: number;
  groupKey: string;
  preserveStringId: boolean;
  isNew: boolean;
}

const HEADER_ALIASES = {
  delimiter: ['구분자', 'delimiter', 'no', '번호'],
  image: ['이미지', 'image', '화면'],
  korean: ['국문', 'korean', 'kr', 'ko'],
  english: ['영문', 'english', 'en'],
  stringId: ['stringid', 'string_id', 'stringkey'],
  note: ['비고', 'note', 'remarks', 'comment'],
} as const;

export const EXISTING_STRING_ID_NOTE = '기존 String ID 활용';
const LEGACY_EXISTING_STRING_ID_NOTE = '기존 String ID 사용';
export const L10N_SYNC_PROPERTY_KEY = 'string-finder-l10n-sync';

function isExistingStringIdNote(value: string): boolean {
  return value === EXISTING_STRING_ID_NOTE || value === LEGACY_EXISTING_STRING_ID_NOTE;
}

function normalizeHeader(value: string): string {
  return value.trim().replace(/[\s-]+/g, '').toLowerCase();
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function findHeaderIndex(headers: string[], aliases: readonly string[]): number | undefined {
  const normalizedAliases = aliases.map(normalizeHeader);
  const index = headers.findIndex((header) => normalizedAliases.includes(normalizeHeader(header)));
  return index >= 0 ? index : undefined;
}

function buildGrid($: ReturnType<typeof load>, rows: CheerioNode[]): GridCell[][] {
  const grids: GridCell[][] = [];
  const active = new Map<number, { cell: GridCell; remaining: number }>();

  rows.forEach((row, rowIndex) => {
    const grid: GridCell[] = [];
    for (const [column, span] of active) {
      grid[column] = span.cell;
      span.remaining -= 1;
      if (span.remaining <= 0) active.delete(column);
    }

    let column = 0;
    $(row).children('th,td').toArray().forEach((cellNode) => {
      if (cellNode.type !== 'tag') return;
      while (grid[column]) column += 1;
      const cell = { element: cellNode, originRow: rowIndex };
      grid[column] = cell;
      const rowspan = Number.parseInt($(cellNode).attr('rowspan') ?? '1', 10);
      if (rowspan > 1) {
        active.set(column, { cell, remaining: rowspan - 1 });
      }
      column += 1;
    });
    grids.push(grid);
  });

  return grids;
}

function parseTables(storage: string): { $: ReturnType<typeof load>; tables: ParsedTable[] } {
  const $ = load(storage, XML_OPTIONS, false);
  const tables: ParsedTable[] = [];

  $('table').toArray().forEach((tableNode, tableIndex) => {
    if (tableNode.type !== 'tag') return;
    const rowNodes = $(tableNode).find('tr').toArray().filter((node) => node.type === 'tag');
    const grids = buildGrid($, rowNodes);
    const headerRowIndex = rowNodes.findIndex((row) => $(row).children('th').length > 0);
    if (headerRowIndex < 0) return;

    const headers = grids[headerRowIndex].map((cell) => cell ? normalizeText($(cell.element).text()) : '');
    const korean = findHeaderIndex(headers, HEADER_ALIASES.korean);
    const english = findHeaderIndex(headers, HEADER_ALIASES.english);
    if (korean === undefined || english === undefined) return;

    const columns: L10nTableColumns = {
      korean,
      english,
      delimiter: findHeaderIndex(headers, HEADER_ALIASES.delimiter),
      image: findHeaderIndex(headers, HEADER_ALIASES.image),
      stringId: findHeaderIndex(headers, HEADER_ALIASES.stringId),
      note: findHeaderIndex(headers, HEADER_ALIASES.note),
    };

    const dataRows = rowNodes.slice(headerRowIndex + 1);
    const dataGrids = grids.slice(headerRowIndex + 1);
    let frameGroup = columns.image === undefined ? 0 : -1;
    const rows = dataRows.map((_, rowIndex): WikiStringRow | null => {
      const grid = dataGrids[rowIndex];
      if (columns.image !== undefined) {
        const imageCell = grid[columns.image];
        if (imageCell?.originRow === rowIndex + headerRowIndex + 1) {
          frameGroup += 1;
        }
        if (frameGroup < 0) frameGroup = 0;
      }

      const textAt = (column: number | undefined) =>
        column === undefined || !grid[column] ? '' : normalizeText($(grid[column].element).text());
      const delimiter = textAt(columns.delimiter);
      const koreanText = textAt(columns.korean);
      const englishText = textAt(columns.english);
      const stringId = textAt(columns.stringId);
      const note = textAt(columns.note);
      if (!delimiter && !koreanText && !englishText && !stringId && !note) return null;

      return {
        rowKey: `${frameGroup}:${delimiter}:${rowIndex}`,
        rowIndex,
        frameGroup,
        delimiter,
        korean: koreanText,
        english: englishText,
        stringId,
        note,
      };
    }).filter((row): row is WikiStringRow => row !== null);

    tables.push({
      tableIndex,
      columns,
      rows,
      hasStringIdColumn: columns.stringId !== undefined,
      tableElement: tableNode,
      dataRows,
      grids: dataGrids,
      headerRowIndex,
    });
  });

  return { $, tables };
}

function buildFigmaTagLookup(frames: FigmaScannedFrame[]): FigmaTagLookup {
  const byFrameAndDelimiter = new Map<string, LocatedFigmaTag>();
  const byDelimiter = new Map<string, LocatedFigmaTag[]>();
  frames.forEach((frame, frameIndex) => frame.strings.forEach((tag) => {
    const located = { tag, frame };
    byFrameAndDelimiter.set(`${frameIndex}:${tag.delimiter}`, located);
    const sameDelimiter = byDelimiter.get(tag.delimiter) ?? [];
    sameDelimiter.push(located);
    byDelimiter.set(tag.delimiter, sameDelimiter);
  }));
  return { byFrameAndDelimiter, byDelimiter };
}

function findFigmaTag(row: WikiStringRow, lookup: FigmaTagLookup): LocatedFigmaTag | undefined {
  const inFrame = lookup.byFrameAndDelimiter.get(`${row.frameGroup}:${row.delimiter}`);
  if (inFrame) return inFrame;
  const sameDelimiter = lookup.byDelimiter.get(row.delimiter) ?? [];
  return sameDelimiter.length === 1 ? sameDelimiter[0] : undefined;
}

function frameKey(fileKey: string, frameId: string): string {
  return `${fileKey}\u0000${frameId}`;
}

function targetKey(fileKey: string, targetNodeId: string): string {
  return `${fileKey}\u0000${targetNodeId}`;
}

function metadataForTag(frame: FigmaScannedFrame, tag: FigmaTaggedString): L10nSyncRowMetadata {
  return {
    fileKey: frame.fileKey,
    frameId: frame.id,
    targetNodeId: tag.targetNodeId,
    tagNodeId: tag.tagNodeId,
    delimiter: tag.delimiter,
  };
}

export function createL10nSyncMetadata(frames: FigmaScannedFrame[]): L10nSyncMetadata {
  const validFrames = frames.filter((frame) => frame.strings.length > 0);
  return {
    schemaVersion: 1,
    rows: validFrames.flatMap((frame) => frame.strings.map((tag) => metadataForTag(frame, tag))),
    frames: validFrames.map((frame) => ({
      fileKey: frame.fileKey,
      frameId: frame.id,
      attachmentName: frame.attachmentName,
    })),
  };
}

export function normalizeL10nSyncMetadata(value: unknown): L10nSyncMetadata | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<L10nSyncMetadata>;
  if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.rows) || !Array.isArray(candidate.frames)) {
    return undefined;
  }
  const rows = candidate.rows.filter((row): row is L10nSyncRowMetadata => Boolean(
    row
      && typeof row.fileKey === 'string'
      && typeof row.frameId === 'string'
      && typeof row.targetNodeId === 'string'
      && typeof row.tagNodeId === 'string'
      && typeof row.delimiter === 'string'
  ));
  const frames = candidate.frames.filter((frame): frame is L10nSyncFrameMetadata => Boolean(
    frame
      && typeof frame.fileKey === 'string'
      && typeof frame.frameId === 'string'
      && typeof frame.attachmentName === 'string'
  ));
  if (rows.length !== candidate.rows.length || frames.length !== candidate.frames.length) {
    return undefined;
  }
  return { schemaVersion: 1, rows, frames };
}

export function findL10nTable(storage: string): L10nTable | null {
  const parsed = parseTables(storage).tables[0];
  if (!parsed) return null;
  return {
    tableIndex: parsed.tableIndex,
    columns: parsed.columns,
    rows: parsed.rows,
    hasStringIdColumn: parsed.hasStringIdColumn,
  };
}

export function createL10nTable(storage: string, frames: FigmaScannedFrame[]): string {
  const rows = frames.flatMap((frame) => frame.strings.map((tag, index) => {
    const imageCell = index === 0
      ? `<td rowspan="${frame.strings.length}"><ac:image><ri:attachment ri:filename="${escapeHtml(frame.attachmentName)}"/></ac:image></td>`
      : '';
    return '<tr>'
      + imageCell
      + `<td>${escapeHtml(tag.delimiter)}</td>`
      + `<td></td><td></td><td>${escapeHtml(tag.korean)}</td><td></td>`
      + '</tr>';
  })).join('');
  const table = '<table data-table-width="1800" data-layout="align-start"><tbody>'
    + '<tr><th>이미지</th><th>구분자</th><th>String ID</th><th>영문</th><th>국문</th><th>비고</th></tr>'
    + rows
    + '</tbody></table>';

  return `${storage}${storage.trim() ? '\n' : ''}${table}`;
}

export function applyStringIdUpdates(storage: string, updates: StringIdUpdate[]): string {
  let parsed = parseTables(storage);
  let table = parsed.tables[0];
  if (!table) {
    throw new Error('String ID를 작성할 L10N 표를 찾을 수 없습니다.');
  }

  let structureChanged = false;
  const allRows = parsed.$(table.tableElement).find('tr').toArray().filter((node) => node.type === 'tag');
  if (table.columns.stringId === undefined) {
    parsed.$(allRows[table.headerRowIndex]).append('<th>String ID</th>');
    table.dataRows.forEach((row) => parsed.$(row).append('<td></td>'));
    structureChanged = true;
  }
  if (table.columns.note === undefined && updates.some((update) => Boolean(update.note))) {
    parsed.$(allRows[table.headerRowIndex]).append('<th>비고</th>');
    table.dataRows.forEach((row) => parsed.$(row).append('<td></td>'));
    structureChanged = true;
  }
  if (structureChanged) {
    parsed = parseTables(parsed.$.html());
    table = parsed.tables[0];
  }

  const updateMap = new Map(updates.map((update) => [update.rowKey, update]));
  for (const row of table.rows) {
    const update = updateMap.get(row.rowKey);
    if (!update) continue;
    const grid = table.grids[row.rowIndex];
    const cell = table.columns.stringId === undefined ? undefined : grid[table.columns.stringId];
    if (cell) {
      parsed.$(cell.element).text(update.stringId);
    }
    const noteCell = table.columns.note === undefined ? undefined : grid[table.columns.note];
    if (noteCell && update.note !== undefined) {
      const currentNote = normalizeText(parsed.$(noteCell.element).text());
      if (update.note || isExistingStringIdNote(currentNote)) {
        parsed.$(noteCell.element).text(update.note);
      }
    }
  }

  return parsed.$.html();
}

function setCellText(
  $: ReturnType<typeof load>,
  table: ParsedTable,
  row: WikiStringRow,
  column: number | undefined,
  value: string,
): void {
  if (column === undefined) return;
  const cell = table.grids[row.rowIndex]?.[column];
  if (cell) $(cell.element).text(value);
}

function copyCellTextIfBlank(
  $: ReturnType<typeof load>,
  table: ParsedTable,
  row: WikiStringRow,
  column: number | undefined,
  value: string,
): void {
  if (column === undefined || !normalizeText(value)) return;
  const cell = table.grids[row.rowIndex]?.[column];
  if (cell && !normalizeText($(cell.element).text())) $(cell.element).text(value);
}

function createDataRow(
  $: ReturnType<typeof load>,
  table: ParsedTable,
  tag: FigmaTaggedString,
): CheerioNode {
  const headerGrid = table.grids[table.headerRowIndex] ?? [];
  const row = $('<tr></tr>');
  for (let column = 0; column < headerGrid.length; column += 1) {
    if (column === table.columns.image) continue;
    const cell = $('<td></td>');
    if (column === table.columns.delimiter) cell.text(tag.delimiter);
    if (column === table.columns.korean) cell.text(tag.korean);
    row.append(cell);
  }
  const node = row.get(0);
  if (!node || node.type !== 'tag') throw new Error('위키 표 행을 생성하지 못했습니다.');
  return node;
}

function insertImageCell(
  $: ReturnType<typeof load>,
  rowNode: CheerioNode,
  imageColumn: number,
  rowSpan: number,
  content: string,
): void {
  const imageCell = $(`<td rowspan="${rowSpan}">${content}</td>`);
  const children = $(rowNode).children('th,td');
  if (imageColumn <= 0) {
    $(rowNode).prepend(imageCell);
  } else if (imageColumn < children.length) {
    children.eq(imageColumn).before(imageCell);
  } else {
    $(rowNode).append(imageCell);
  }
}

function compareDelimiter(a: ReconciledRow, b: ReconciledRow): number {
  if (!a.metadata.delimiter && !b.metadata.delimiter) return a.originalOrder - b.originalOrder;
  if (!a.metadata.delimiter) return 1;
  if (!b.metadata.delimiter) return -1;
  return a.metadata.delimiter.localeCompare(b.metadata.delimiter, undefined, { numeric: true });
}

export function applyFigmaSourceUpdates(
  storage: string,
  frames: FigmaScannedFrame[],
  suppliedMetadata?: L10nSyncMetadata,
): FigmaSourceUpdateResult {
  const parsed = parseTables(storage);
  const table = parsed.tables[0];
  if (!table) throw new Error('Figma 국문을 반영할 L10N 표를 찾을 수 없습니다.');

  const validFrames = frames.filter((frame) => frame.strings.length > 0);
  const legacyLookup = buildFigmaTagLookup(validFrames);
  const frameByKey = new Map(validFrames.map((frame) => [frameKey(frame.fileKey, frame.id), frame]));
  const tagByTarget = new Map<string, LocatedFigmaTag>();
  validFrames.forEach((frame) => frame.strings.forEach((tag) => {
    tagByTarget.set(targetKey(frame.fileKey, tag.targetNodeId), { frame, tag });
  }));

  const canUseMetadata = suppliedMetadata?.schemaVersion === 1
    && suppliedMetadata.rows.length === table.rows.length;
  const oldMetadata = canUseMetadata ? suppliedMetadata : undefined;
  const usedTargets = new Set<string>();
  const changedFrameKeys = new Set<string>();
  const issues: L10nIssue[] = [];
  if (suppliedMetadata && !canUseMetadata) {
    issues.push({
      code: 'WIKI_METADATA_MISMATCH',
      message: '위키 표의 행 구조가 저장된 Figma 연결 정보와 다릅니다. 확인 후 다시 실행해 주세요.',
    });
  }
  const reconciledRows: ReconciledRow[] = [];
  const oldImageByGroup = new Map<number, string>();
  const oldAttachmentByGroup = new Map<number, string>();
  const oldGroupKeyByIndex = new Map<number, string>();

  if (table.columns.image !== undefined) {
    table.rows.forEach((row) => {
      const imageCell = table.grids[row.rowIndex]?.[table.columns.image!];
      if (!imageCell) return;
      if (!oldImageByGroup.has(row.frameGroup)) {
        oldImageByGroup.set(row.frameGroup, parsed.$(imageCell.element).html() ?? '');
        const attachmentName = parsed.$(imageCell.element)
          .find('ri\\:attachment')
          .first()
          .attr('ri:filename');
        if (attachmentName) oldAttachmentByGroup.set(row.frameGroup, attachmentName);
      }
    });
  }

  const currentOwnerRowByTarget = new Map<string, number>();
  oldMetadata?.rows.forEach((metadata, index) => {
    if (!metadata.fileKey || !metadata.targetNodeId) return;
    const currentTargetKey = targetKey(metadata.fileKey, metadata.targetNodeId);
    if (tagByTarget.has(currentTargetKey)) currentOwnerRowByTarget.set(currentTargetKey, index);
  });

  table.rows.forEach((row, index) => {
    let metadata = oldMetadata?.rows[index];
    let located = metadata
      ? tagByTarget.get(targetKey(metadata.fileKey, metadata.targetNodeId))
      : undefined;
    const recoverableLegacy = Boolean(metadata && (!metadata.fileKey || !metadata.targetNodeId));
    if (!metadata || recoverableLegacy) {
      const attachmentName = oldAttachmentByGroup.get(row.frameGroup);
      const attachmentFrame = attachmentName
        ? validFrames.find((frame) => frame.attachmentName === attachmentName)
        : undefined;
      const attachmentMatches = attachmentFrame?.strings
        .filter((tag) => tag.delimiter === row.delimiter) ?? [];
      if (attachmentFrame && attachmentMatches.length === 1) {
        located = { frame: attachmentFrame, tag: attachmentMatches[0] };
      } else if (attachmentFrame && normalizeText(row.korean)) {
        const koreanMatches = attachmentFrame.strings.filter((tag) =>
          normalizeText(tag.korean) === normalizeText(row.korean));
        if (koreanMatches.length === 1) {
          located = { frame: attachmentFrame, tag: koreanMatches[0] };
        }
      }
    }
    if (!metadata && !located) {
      located = findFigmaTag(row, legacyLookup);
    }
    if ((!metadata || recoverableLegacy) && located) {
      const currentTargetKey = targetKey(located.frame.fileKey, located.tag.targetNodeId);
      const currentOwnerIndex = currentOwnerRowByTarget.get(currentTargetKey);
      if (currentOwnerIndex !== undefined && currentOwnerIndex !== index) {
        const currentOwner = table.rows[currentOwnerIndex];
        copyCellTextIfBlank(parsed.$, table, currentOwner, table.columns.stringId, row.stringId);
        copyCellTextIfBlank(parsed.$, table, currentOwner, table.columns.english, row.english);
        copyCellTextIfBlank(parsed.$, table, currentOwner, table.columns.note, row.note);

        const currentGroupKey = frameKey(located.frame.fileKey, located.frame.id);
        oldGroupKeyByIndex.set(row.frameGroup, currentGroupKey);
        changedFrameKeys.add(currentGroupKey);
        usedTargets.add(currentTargetKey);
        return;
      }
      metadata = metadataForTag(located.frame, located.tag);
    }

    if (!metadata) {
      metadata = {
        fileKey: '',
        frameId: `legacy-${row.frameGroup}`,
        targetNodeId: '',
        tagNodeId: '',
        delimiter: row.delimiter,
      };
    }

    const previousFrameKey = frameKey(metadata.fileKey, metadata.frameId);
    oldGroupKeyByIndex.set(row.frameGroup, previousFrameKey);
    let preserveStringId = false;
    let groupKey = previousFrameKey;

    if (located) {
      const currentTargetKey = targetKey(located.frame.fileKey, located.tag.targetNodeId);
      usedTargets.add(currentTargetKey);
      groupKey = frameKey(located.frame.fileKey, located.frame.id);
      const koreanChanged = normalizeText(row.korean) !== normalizeText(located.tag.korean);
      const structureChanged = metadata.tagNodeId !== located.tag.tagNodeId
        || metadata.delimiter !== located.tag.delimiter
        || metadata.frameId !== located.frame.id
        || metadata.fileKey !== located.frame.fileKey;
      if (koreanChanged || structureChanged) changedFrameKeys.add(groupKey);

      setCellText(parsed.$, table, row, table.columns.delimiter, located.tag.delimiter);
      setCellText(parsed.$, table, row, table.columns.korean, located.tag.korean);
      if (koreanChanged) {
        if (isExistingStringIdNote(row.note)) {
          setCellText(parsed.$, table, row, table.columns.stringId, '');
          setCellText(parsed.$, table, row, table.columns.note, '');
        } else {
          preserveStringId = true;
        }
      }
      metadata = metadataForTag(located.frame, located.tag);
    } else {
      if (row.delimiter) {
        setCellText(parsed.$, table, row, table.columns.delimiter, '');
        const currentOldFrame = frameByKey.get(previousFrameKey);
        if (currentOldFrame) changedFrameKeys.add(previousFrameKey);
      }
      issues.push({
        code: 'FIGMA_TAG_MISSING',
        message: `기존 위키 행을 가리키는 유효한 Figma 태그가 없습니다.`,
        rowKey: row.rowKey,
        delimiter: metadata.delimiter || row.delimiter,
        frameName: frameByKey.get(previousFrameKey)?.name,
        korean: row.korean,
      });
    }

    reconciledRows.push({
      node: table.dataRows[row.rowIndex],
      metadata,
      originalFrameGroup: row.frameGroup,
      originalOrder: index,
      groupKey,
      preserveStringId,
      isNew: false,
    });
  });

  validFrames.forEach((frame) => frame.strings.forEach((tag) => {
    const currentTargetKey = targetKey(frame.fileKey, tag.targetNodeId);
    if (usedTargets.has(currentTargetKey)) return;
    const groupKey = frameKey(frame.fileKey, frame.id);
    changedFrameKeys.add(groupKey);
    reconciledRows.push({
      node: createDataRow(parsed.$, table, tag),
      metadata: metadataForTag(frame, tag),
      originalFrameGroup: Number.MAX_SAFE_INTEGER,
      originalOrder: Number.MAX_SAFE_INTEGER,
      groupKey,
      preserveStringId: false,
      isNew: true,
    });
    usedTargets.add(currentTargetKey);
  }));

  const groupOrder: string[] = [];
  const addGroup = (key: string) => {
    if (!groupOrder.includes(key)) groupOrder.push(key);
  };
  [...table.rows]
    .sort((a, b) => a.frameGroup - b.frameGroup || a.rowIndex - b.rowIndex)
    .forEach((row) => addGroup(oldGroupKeyByIndex.get(row.frameGroup) ?? `legacy\u0000${row.frameGroup}`));
  validFrames.forEach((frame) => addGroup(frameKey(frame.fileKey, frame.id)));
  reconciledRows.forEach((row) => addGroup(row.groupKey));

  const grouped = new Map<string, ReconciledRow[]>();
  reconciledRows.forEach((row) => {
    const rows = grouped.get(row.groupKey) ?? [];
    rows.push(row);
    grouped.set(row.groupKey, rows);
  });
  for (const rows of grouped.values()) {
    const existing = rows.filter((row) => !row.isNew);
    const additions = rows.filter((row) => row.isNew).sort(compareDelimiter);
    for (const addition of additions) {
      const nextIndex = existing.findIndex((row) =>
        Boolean(row.metadata.delimiter)
          && compareDelimiter(addition, row) < 0);
      if (nextIndex >= 0) existing.splice(nextIndex, 0, addition);
      else {
        let lastActive = -1;
        for (let index = existing.length - 1; index >= 0; index -= 1) {
          if (existing[index].metadata.delimiter) {
            lastActive = index;
            break;
          }
        }
        existing.splice(lastActive + 1, 0, addition);
      }
    }
    grouped.set(rows[0].groupKey, existing);
  }

  if (table.columns.image !== undefined) {
    const removed = new Set<CheerioNode>();
    table.rows.forEach((row) => {
      const imageCell = table.grids[row.rowIndex]?.[table.columns.image!];
      if (imageCell && !removed.has(imageCell.element)) {
        parsed.$(imageCell.element).remove();
        removed.add(imageCell.element);
      }
    });
  }

  const orderedRows = groupOrder.flatMap((key) => grouped.get(key) ?? []);
  const container = parsed.$(table.tableElement).children('tbody').first();
  const targetContainer = container.length > 0 ? container : parsed.$(table.tableElement);
  table.dataRows.forEach((row) => parsed.$(row).remove());
  for (const key of groupOrder) {
    const rows = grouped.get(key) ?? [];
    if (rows.length === 0) continue;
    if (table.columns.image !== undefined) {
      const currentFrame = frameByKey.get(key);
      const oldGroup = rows.find((row) => row.originalFrameGroup !== Number.MAX_SAFE_INTEGER)
        ?.originalFrameGroup;
      const imageContent = currentFrame
        ? `<ac:image><ri:attachment ri:filename="${escapeHtml(currentFrame.attachmentName)}"/></ac:image>`
        : oldGroup === undefined ? '' : oldImageByGroup.get(oldGroup) ?? '';
      insertImageCell(parsed.$, rows[0].node, table.columns.image, rows.length, imageContent);
    }
    rows.forEach((row) => targetContainer.append(row.node));
  }

  const nextStorage = parsed.$.html();
  const finalTable = findL10nTable(nextStorage);
  const preservedStringIdRowKeys = new Set<string>();
  orderedRows.forEach((row, index) => {
    if (row.preserveStringId && finalTable?.rows[index]) {
      preservedStringIdRowKeys.add(finalTable.rows[index].rowKey);
    }
  });
  const metadata: L10nSyncMetadata = {
    schemaVersion: 1,
    rows: orderedRows.map((row) => row.metadata),
    frames: validFrames.map((frame) => ({
      fileKey: frame.fileKey,
      frameId: frame.id,
      attachmentName: frame.attachmentName,
    })),
  };

  return {
    storage: nextStorage,
    changedFrames: validFrames.filter((frame) =>
      changedFrameKeys.has(frameKey(frame.fileKey, frame.id))),
    preservedStringIdRowKeys,
    metadata,
    issues,
  };
}

export function compareWikiRows(
  table: L10nTable,
  frames: FigmaScannedFrame[],
  metadata?: L10nSyncMetadata,
): WikiComparisonResult {
  const lookup = buildFigmaTagLookup(frames);
  const byTarget = new Map<string, FigmaTaggedString>();
  frames.forEach((frame) => frame.strings.forEach((tag) => {
    byTarget.set(targetKey(frame.fileKey, tag.targetNodeId), tag);
  }));

  const matched: MatchedWikiString[] = [];
  const issues: L10nIssue[] = [];
  const usedTags = new Set<string>();

  for (const [rowIndex, row] of table.rows.entries()) {
    const rowMetadata = metadata?.rows[rowIndex];
    const tag = rowMetadata
      ? byTarget.get(targetKey(rowMetadata.fileKey, rowMetadata.targetNodeId))
      : findFigmaTag(row, lookup)?.tag;

    if (!tag) {
      issues.push({
        code: 'FIGMA_TAG_MISSING',
        message: '기존 위키 행을 가리키는 유효한 Figma 태그가 없습니다.',
        rowKey: row.rowKey,
        delimiter: rowMetadata?.delimiter || row.delimiter,
        korean: row.korean,
      });
      continue;
    }

    usedTags.add(tag.tagNodeId);
    if (normalizeText(tag.korean) !== normalizeText(row.korean)) {
      issues.push({
        code: 'KOREAN_MISMATCH',
        message: `구분자 ${row.delimiter}의 국문이 Figma와 다릅니다.`,
        rowKey: row.rowKey,
        delimiter: row.delimiter,
        frameName: tag.frame.name,
        korean: row.korean,
      });
      continue;
    }

    matched.push({
      ...tag,
      rowKey: row.rowKey,
      english: row.english,
      stringId: row.stringId,
    });
  }

  frames.flatMap((frame) => frame.strings).forEach((tag) => {
    if (usedTags.has(tag.tagNodeId)) return;
    issues.push({
      code: 'WIKI_ROW_MISSING',
      message: `Figma 구분자 ${tag.delimiter}에 대응하는 위키 행이 없습니다.`,
      rowKey: tag.tagNodeId,
      delimiter: tag.delimiter,
      frameName: tag.frame.name,
      korean: tag.korean,
    });
  });

  return { matched, issues };
}
