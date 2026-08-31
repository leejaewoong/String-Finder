import { describe, expect, it } from 'vitest';
import {
  extractPcReleaseDate,
  extractVersionCode,
  resolveReleaseDate,
  selectVersionSource,
} from '../releaseDate';

describe('extractVersionCode', () => {
  it('normalizes a version title with a sub-version suffix', () => {
    expect(extractVersionCode('[v2607-10] 메시지')).toBe('v2607');
    expect(extractVersionCode('v2612 외형 챌린지')).toBe('v2612');
  });
});

describe('selectVersionSource', () => {
  it('prefers the wiki version and warns when Figma differs', () => {
    expect(selectVersionSource('v2607', 'v2608')).toEqual({
      version: 'v2607',
      source: 'wiki',
      warning: '위키(v2607)와 Figma(v2608)의 버전이 달라 위키를 기준으로 사용합니다.',
    });
  });

  it('uses Figma when the wiki title has no version', () => {
    expect(selectVersionSource(undefined, 'v2608')).toEqual({
      version: 'v2608',
      source: 'figma',
    });
  });
});

describe('extractPcReleaseDate', () => {
  it('returns the PC date from the row matching the version', () => {
    const storage = '<table><tbody>'
      + '<tr><th>업데이트</th><th>플랫폼</th><th>업데이트 일자</th></tr>'
      + '<tr><td>v2607</td><td>Console</td><td>2026-07-16</td></tr>'
      + '<tr><td>v2607</td><td>PC</td><td>2026-07-09</td></tr>'
      + '</tbody></table>';

    expect(extractPcReleaseDate(storage, 'v2607')).toBe('2026-07-09');
  });
});

describe('resolveReleaseDate', () => {
  it('uses the wiki version and finds the PC date in the matching year child page', async () => {
    const reader = {
      getPage: async () => ({
        id: '134241634',
        status: 'current',
        title: 'UPDATE',
        spaceId: '1',
        version: 1,
        storage: '',
      }),
      getChildPages: async (pageId: string) => pageId === '134241634'
        ? [{ id: '2026', title: '2026 UPDATE', version: 1, storage: '' }]
        : [{
          id: '2612',
          title: 'v2612',
          version: 1,
          storage: '<table><tr><th>업데이트</th><th>플랫폼</th><th>날짜</th></tr>'
            + '<tr><td>v2612</td><td>PC</td><td>2026-12-03</td></tr></table>',
        }],
    };

    await expect(resolveReleaseDate(
      '[v2612-10] 외형 챌린지',
      ['v2611 다른 피그마'],
      reader,
    )).resolves.toEqual({
      releaseDate: '2026-12-03',
      version: 'v2612',
      source: 'wiki',
      warning: '위키(v2612)와 Figma(v2611)의 버전이 달라 위키를 기준으로 사용합니다.',
    });
  });
});
