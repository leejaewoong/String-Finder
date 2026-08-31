import { load, type HTMLParser2Options } from 'cheerio';

const XML_OPTIONS: HTMLParser2Options = { xmlMode: true, decodeEntities: false };

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
