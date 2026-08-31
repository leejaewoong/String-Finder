import { FigmaNode } from '../../figmaTag';

export const figmaSpecFixture: FigmaNode = {
  id: '1896:82522',
  name: '스펙 페이지',
  type: 'FRAME',
  absoluteBoundingBox: { x: 0, y: 0, width: 2924, height: 1959 },
  children: [
    {
      id: 'tag:A',
      name: '03. 스트링 태그 (%stringTag^A^GEAR HEAD I - CONTRABAND CRATE^I1889:25171;8970:7176^피쳐:화면_타입_숫자)',
      type: 'INSTANCE',
      absoluteBoundingBox: { x: 2200, y: 100, width: 28, height: 28 },
    },
    {
      id: 'tag:B',
      name: '03. 스트링 태그 (%stringTag^B^Random Map^1889:25196^FEATURE:SCREEN_BUTTON_0)',
      type: 'INSTANCE',
      absoluteBoundingBox: { x: 2200, y: 160, width: 28, height: 28 },
    },
    {
      id: '1889:25160',
      name: '메인_외형 챌린지 선택',
      type: 'FRAME',
      absoluteBoundingBox: { x: 0, y: 0, width: 1920, height: 1080 },
      children: [
        {
          id: 'I1889:25171;8970:7176',
          name: 'Text',
          type: 'TEXT',
          characters: '외형 챌린지',
          absoluteBoundingBox: { x: 620, y: 5, width: 148, height: 35 },
        },
        {
          id: '1889:25196',
          name: 'Random Map',
          type: 'INSTANCE',
          componentProperties: {
            Text: { type: 'TEXT', value: '랜덤 맵' },
          },
          absoluteBoundingBox: { x: 120, y: 180, width: 180, height: 40 },
        },
      ],
    },
  ],
};
