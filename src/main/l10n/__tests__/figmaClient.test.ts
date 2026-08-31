import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FigmaClient } from '../figmaClient';
import { figmaSpecFixture } from './fixtures/figmaNodes';

const createdPaths: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(createdPaths.splice(0).map((createdPath) =>
    rm(createdPath, { recursive: true, force: true })
  ));
});

describe('FigmaClient', () => {
  it('scans a selected node with the Figma token and returns grouped tagged strings', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ 'X-Figma-Token': 'figma-token' });
      expect(String(input)).toContain('/v1/files/JlDaMGG4uOXALKTp4nMTgD/nodes?ids=1896%3A82522');
      return new Response(JSON.stringify({
        name: 'v2612 외형 챌린지',
        nodes: {
          '1896:82522': { document: figmaSpecFixture },
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const client = new FigmaClient('figma-token', fetchImpl);

    const result = await client.scan([
      'https://www.figma.com/design/JlDaMGG4uOXALKTp4nMTgD/v2612?node-id=1896-82522',
    ]);

    expect(result.fileTitles).toEqual(['v2612 외형 챌린지']);
    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]).toMatchObject({
      fileKey: 'JlDaMGG4uOXALKTp4nMTgD',
      id: '1889:25160',
      strings: [
        expect.objectContaining({ delimiter: 'A', korean: '외형 챌린지' }),
        expect.objectContaining({ delimiter: 'B', korean: '랜덤 맵' }),
      ],
    });
  });

  it('downloads the rendered frame to the requested temporary file', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input).includes('/v1/images/')) {
        return new Response(JSON.stringify({ images: { '1889:25160': 'https://images.test/frame.png' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    });
    const root = await mkdtemp(path.join(tmpdir(), 'string-finder-figma-'));
    createdPaths.push(root);
    const outputPath = path.join(root, 'nested', 'frame.png');
    const client = new FigmaClient('figma-token', fetchImpl);

    await client.exportFrame('JlDaMGG4uOXALKTp4nMTgD', '1889:25160', outputPath);

    expect([...await readFile(outputPath)]).toEqual([1, 2, 3]);
  });
});
