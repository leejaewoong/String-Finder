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
    const screenFrame = fixture.children?.find((node) => node.id === '1889:25160');
    fixture.children = screenFrame?.children?.filter((node) => node.id.startsWith('tag:'));

    expect(collectStringTagLocators(fixture)).toEqual([
      'I1889:25171;8970:7176',
      '1889:25196',
    ]);
  });

  it('selects the nearest frame shared by the tag and its target text', () => {
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
      layerPath: ['스펙 페이지', '메인_외형 챌린지 선택', 'Frame 66791', 'Text'],
      layerTypes: ['FRAME', 'FRAME', 'FRAME', 'TEXT'],
      screenContext: expect.arrayContaining([
        expect.objectContaining({
          name: 'Tab Item',
          text: '외형 챌린지',
          states: { Selected: true },
        }),
        expect.objectContaining({
          name: 'Title',
          text: '외형 챌린지',
        }),
        expect.objectContaining({
          name: 'Global Header',
          text: '로비',
          states: { State: 'Lobby' },
        }),
      ]),
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

  it('keeps one row and reports duplicate tags that target the same node', () => {
    const fixture = structuredClone(figmaSpecFixture);
    const frame = fixture.children?.find((node) => node.id === '1889:25160');
    frame?.children?.push({
      id: 'tag:C',
      name: '03. 스트링 태그 (%stringTag^C^Random Map duplicate^1889:25196^FEATURE:SCREEN_BUTTON_0)',
      type: 'INSTANCE',
    });

    const result = scanStringTags(fixture);

    expect(result.strings).toHaveLength(2);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'FIGMA_TARGET_DUPLICATE',
        rowKey: 'tag:C',
        delimiter: 'C',
      }),
    ]));
  });
});
