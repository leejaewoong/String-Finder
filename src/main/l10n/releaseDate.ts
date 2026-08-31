import { load, type HTMLParser2Options } from 'cheerio';
import { ReleaseDateSuggestion } from '../../shared/l10nTypes';

const XML_OPTIONS: HTMLParser2Options = { xmlMode: true, decodeEntities: false };
export const UPDATE_PAGE_ID = '134241634';

interface ReleaseDatePage {
  id: string;
  title: string;
  storage: string;
}

export interface ReleaseDatePageReader {
  getPage(pageId: string, signal?: AbortSignal): Promise<ReleaseDatePage>;
  getChildPages(pageId: string, signal?: AbortSignal): Promise<ReleaseDatePage[]>;
}

export interface SelectedVersion {
  version?: string;
  source: 'wiki' | 'figma' | 'manual';
  warning?: string;
}

export function extractVersionCode(title: string | undefined): string | undefined {
  if (!title) return undefined;
  const match = title.match(/v(\d{2})(0[1-9]|1[0-2])/i);
  return match ? `v${match[1]}${match[2]}`.toLowerCase() : undefined;
}

export function selectVersionSource(
  wikiVersion: string | undefined,
  figmaVersion: string | undefined,
): SelectedVersion {
  if (wikiVersion) {
    return {
      version: wikiVersion,
      source: 'wiki',
      ...(figmaVersion && figmaVersion !== wikiVersion
        ? { warning: `위키(${wikiVersion})와 Figma(${figmaVersion})의 버전이 달라 위키를 기준으로 사용합니다.` }
        : {}),
    };
  }
  if (figmaVersion) {
    return { version: figmaVersion, source: 'figma' };
  }
  return { source: 'manual' };
}

function normalizeDate(value: string): string | undefined {
  const match = value.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/);
  if (!match) return undefined;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

export function extractPcReleaseDate(storage: string, version: string): string | undefined {
  const $ = load(storage, XML_OPTIONS, false);
  const normalizedVersion = version.toLowerCase();

  for (const table of $('table').toArray()) {
    const rows = $(table).find('tr').toArray();
    const headerCells = rows[0] ? $(rows[0]).children('th,td').toArray().map((cell) => $(cell).text().trim()) : [];
    const pcColumn = headerCells.findIndex((cell) => /^pc$/i.test(cell));

    for (const row of rows.slice(1)) {
      const cells = $(row).children('th,td').toArray().map((cell) => $(cell).text().trim());
      if (!cells.join(' ').toLowerCase().includes(normalizedVersion)) continue;

      if (pcColumn >= 0) {
        const date = normalizeDate(cells[pcColumn] ?? '');
        if (date) return date;
      }

      const platformIndex = cells.findIndex((cell) => /^pc$/i.test(cell));
      if (platformIndex >= 0) {
        for (const cell of cells.slice(platformIndex + 1)) {
          const date = normalizeDate(cell);
          if (date) return date;
        }
      }
    }
  }

  return undefined;
}

export async function resolveReleaseDate(
  wikiTitle: string | undefined,
  figmaTitles: string[],
  reader: ReleaseDatePageReader,
  signal?: AbortSignal,
): Promise<ReleaseDateSuggestion> {
  const wikiVersion = extractVersionCode(wikiTitle);
  const figmaVersions = [...new Set(figmaTitles.map(extractVersionCode).filter(Boolean))] as string[];
  const selected = selectVersionSource(wikiVersion, figmaVersions[0]);
  if (!selected.version) {
    return { releaseDate: '', source: 'manual' };
  }

  const root = await reader.getPage(UPDATE_PAGE_ID, signal);
  const rootChildren = await reader.getChildPages(UPDATE_PAGE_ID, signal);
  const year = `20${selected.version.slice(1, 3)}`;
  const yearPages = rootChildren.filter((page) => page.title.includes(year));
  const detailPages = (await Promise.all(
    yearPages.map((page) => reader.getChildPages(page.id, signal)),
  )).flat();
  const candidates = [root, ...rootChildren, ...detailPages];
  const releaseDate = candidates
    .map((page) => extractPcReleaseDate(page.storage, selected.version!))
    .find(Boolean) ?? '';

  let warning = selected.warning;
  if (!warning && figmaVersions.length > 1) {
    warning = `Figma 파일의 버전이 서로 달라 ${figmaVersions[0]}을 기준으로 사용합니다.`;
  }
  return {
    releaseDate,
    version: selected.version,
    source: selected.source,
    ...(warning ? { warning } : {}),
  };
}
