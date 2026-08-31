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
}

export interface WikiStringRow {
  rowKey: string;
  rowIndex: number;
  frameGroup: number;
  delimiter: string;
  korean: string;
  english: string;
  stringId: string;
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

const HEADER_ALIASES = {
  delimiter: ['구분자', 'delimiter', 'no', '번호'],
  image: ['이미지', 'image', '화면'],
  korean: ['국문', 'korean', 'kr', 'ko'],
  english: ['영문', 'english', 'en'],
  stringId: ['stringid', 'string_id', 'stringkey'],
} as const;

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
      if (!delimiter && !koreanText && !englishText && !stringId) return null;

      return {
        rowKey: `${frameGroup}:${delimiter}:${rowIndex}`,
        rowIndex,
        frameGroup,
        delimiter,
        korean: koreanText,
        english: englishText,
        stringId,
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
      + `<td>${escapeHtml(tag.delimiter)}</td>`
      + imageCell
      + `<td>${escapeHtml(tag.korean)}</td><td></td><td></td>`
      + '</tr>';
  })).join('');
  const table = '<table><tbody>'
    + '<tr><th>구분자</th><th>이미지</th><th>국문</th><th>영문</th><th>String ID</th></tr>'
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

  if (table.columns.stringId === undefined) {
    const allRows = parsed.$(table.tableElement).find('tr').toArray().filter((node) => node.type === 'tag');
    parsed.$(allRows[table.headerRowIndex]).append('<th>String ID</th>');
    table.dataRows.forEach((row) => parsed.$(row).append('<td></td>'));
    parsed = parseTables(parsed.$.html());
    table = parsed.tables[0];
  }

  const updateMap = new Map(updates.map((update) => [update.rowKey, update.stringId]));
  for (const row of table.rows) {
    const value = updateMap.get(row.rowKey);
    if (value === undefined) continue;
    const grid = table.grids[row.rowIndex];
    const cell = table.columns.stringId === undefined ? undefined : grid[table.columns.stringId];
    if (cell) {
      parsed.$(cell.element).text(value);
    }
  }

  return parsed.$.html();
}

export function compareWikiRows(
  table: L10nTable,
  frames: FigmaScannedFrame[],
): WikiComparisonResult {
  const tagByFrameAndDelimiter = new Map<string, FigmaTaggedString>();
  const tagsByDelimiter = new Map<string, FigmaTaggedString[]>();
  frames.forEach((frame, frameIndex) => frame.strings.forEach((tag) => {
    tagByFrameAndDelimiter.set(`${frameIndex}:${tag.delimiter}`, tag);
    const existing = tagsByDelimiter.get(tag.delimiter) ?? [];
    existing.push(tag);
    tagsByDelimiter.set(tag.delimiter, existing);
  }));

  const matched: MatchedWikiString[] = [];
  const issues: L10nIssue[] = [];
  const usedTags = new Set<string>();

  for (const row of table.rows) {
    let tag = tagByFrameAndDelimiter.get(`${row.frameGroup}:${row.delimiter}`);
    if (!tag) {
      const sameDelimiter = tagsByDelimiter.get(row.delimiter) ?? [];
      if (sameDelimiter.length === 1) tag = sameDelimiter[0];
    }

    if (!tag) {
      issues.push({
        code: 'FIGMA_TAG_MISSING',
        message: `구분자 ${row.delimiter}에 대응하는 Figma 태그가 없습니다.`,
        rowKey: row.rowKey,
        delimiter: row.delimiter,
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
    });
  });

  return { matched, issues };
}
