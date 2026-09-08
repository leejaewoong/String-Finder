import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StringIdGenerator } from '../components/StringIdGenerator';

describe('StringIdGenerator review issues', () => {
  it('offers frame and status views with frame view selected by default', () => {
    const html = renderToStaticMarkup(
      <StringIdGenerator
        taskState={{
          stage: 'wiki-review',
          label: 'STRING ID 검토 중',
          attentionCount: 1,
          issues: [{
            code: 'ENGLISH_MISSING',
            message: '영문이 비어 있습니다.',
            frameName: '메인',
            delimiter: 'A',
            korean: '외형 챌린지',
          }],
          stats: {
            total: 1,
            matched: 1,
            reused: 0,
            created: 1,
            common: 0,
            renumbered: 0,
            skipped: 0,
          },
          canGenerate: true,
          canFinalize: false,
          canCancel: true,
        }}
        draft={{
          wikiUrl: 'https://example.atlassian.net/wiki/spaces/P/pages/123/Test',
          figmaText: 'https://www.figma.com/design/file-key/v2612?node-id=1-2',
          featurePrefix: 'CLAN',
          releaseDate: '2026-12-03',
          releaseDateSource: 'auto',
        }}
        onDraftChange={() => undefined}
        onStateChange={() => undefined}
        onCancel={async () => undefined}
        onComplete={async () => undefined}
      />,
    );

    expect(html).toContain('aria-label="확인 항목 보기 방식"');
    expect(html).toContain('aria-pressed="true">프레임별</button>');
    expect(html).toContain('aria-pressed="false">상태별</button>');
  });

  it('renders the same update and version footer used by search', () => {
    const html = renderToStaticMarkup(
      <StringIdGenerator
        taskState={{
          stage: 'idle',
          label: '',
          attentionCount: 0,
          issues: [],
          stats: {
            total: 0,
            matched: 0,
            reused: 0,
            created: 0,
            common: 0,
            renumbered: 0,
            skipped: 0,
          },
          canGenerate: true,
          canFinalize: false,
          canCancel: false,
        }}
        draft={{
          wikiUrl: '',
          figmaText: '',
          featurePrefix: '',
          releaseDate: '',
          releaseDateSource: 'auto',
        }}
        onDraftChange={() => undefined}
        onStateChange={() => undefined}
        onCancel={async () => undefined}
        onComplete={async () => undefined}
      />,
    );

    expect(html).toContain('경로를 설정해주세요');
    expect(html).toContain('v1.0.0');
  });
});
