import { describe, expect, it } from 'vitest';
import {
  collectStringTagLocators,
  parseFigmaUrl,
  parseStringTagName,
  scanStringTags,
} from '../figmaTag';
import { figmaSpecFixture } from './fixtures/figmaNodes';

describe('parseFigmaUrl', () => {
  it('extracts the file key and converts a URL node id to the REST id format', () => {
    expect(parseFigmaUrl(
      'https://www.figma.com/design/JlDaMGG4uOXALKTp4nMTgD/v2612?node-id=1896-82522&t=abc'
    )).toEqual({
      fileKey: 'JlDaMGG4uOXALKTp4nMTgD',
      nodeId: '1896:82522',
    });
  });

  it('rejects URLs that are not Figma design files', () => {
    expect(() => parseFigmaUrl('https://example.com/design/file')).toThrow('Figma URL');
  });
});

describe('parseStringTagName', () => {
  it('parses the delimiter and preserves an instance node locator as one value', () => {
    expect(parseStringTagName(
      '03. 스트링 태그 (%stringTag^A^GEAR HEAD^I1889:25171;8970:7176^피쳐:화면_타입_숫자)'
    )).toEqual({
      delimiter: 'A',
      label: 'GEAR HEAD',
      locator: 'I1889:25171;8970:7176',
      stringIdHint: '피쳐:화면_타입_숫자',
    });
  });

  it('ignores ordinary layers and rejects malformed string tags', () => {
    expect(parseStringTagName('일반 텍스트')).toBeNull();
    expect(() => parseStringTagName('스트링 태그 (%stringTag^A^broken)'))
      .toThrow('스트링 태그');
  });
});

describe('scanStringTags', () => {
  it('collects referenced locators before target nodes are loaded', () => {
    const fixture = structuredClone(figmaSpecFixture);
    fixture.children = fixture.children?.filter((node) => node.type !== 'FRAME');

    expect(collectStringTagLocators(fixture)).toEqual([
      'I1889:25171;8970:7176',
      '1889:25196',
    ]);
  });

  it('uses the referenced target text and selects the outermost frame excluding the tag', () => {
    const result = scanStringTags(figmaSpecFixture);

    expect(result.issues).toEqual([]);
    expect(result.strings).toHaveLength(2);
    expect(result.strings[0]).toMatchObject({
      delimiter: 'A',
      korean: '외형 챌린지',
      targetNodeId: 'I1889:25171;8970:7176',
      frame: {
        id: '1889:25160',
        name: '메인_외형 챌린지 선택',
      },
    });
    expect(result.strings[1]).toMatchObject({
      delimiter: 'B',
      korean: '랜덤 맵',
      frame: { id: '1889:25160' },
    });
    expect(result.frames).toHaveLength(1);
  });

  it('reports only a broken tag and keeps valid tagged strings', () => {
    const fixture = structuredClone(figmaSpecFixture);
    fixture.children?.push({
      id: 'tag:broken',
      name: '스트링 태그 (%stringTag^C^Missing^999:999^FEATURE:SCREEN_BODY_0)',
      type: 'INSTANCE',
    });

    const result = scanStringTags(fixture);

    expect(result.strings).toHaveLength(2);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'FIGMA_TARGET_MISSING',
        delimiter: 'C',
      }),
    ]);
  });
});
