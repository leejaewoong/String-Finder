import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfluenceClient, parseConfluencePageUrl } from '../confluenceClient';

const createdPaths: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(createdPaths.splice(0).map((createdPath) =>
    rm(createdPath, { recursive: true, force: true })
  ));
});

describe('parseConfluencePageUrl', () => {
  it('extracts a numeric page id from a Confluence page URL', () => {
    expect(parseConfluencePageUrl(
      'https://krafton.atlassian.net/wiki/spaces/PUBGPC/pages/912297733/UGC+String+ID'
    )).toBe('912297733');
  });
});

describe('ConfluenceClient', () => {
  it('reads storage format with Basic authentication', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        Authorization: `Basic ${Buffer.from('user@krafton.com:token').toString('base64')}`,
      });
      return new Response(JSON.stringify({
        id: '912297733',
        status: 'current',
        title: '[v2607] String ID',
        spaceId: 'space-id',
        version: { number: 3 },
        body: { storage: { value: '<p>본문</p>', representation: 'storage' } },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const client = new ConfluenceClient(
      'https://krafton.atlassian.net/',
      'user@krafton.com',
      'token',
      fetchImpl,
    );

    await expect(client.getPage('912297733')).resolves.toMatchObject({
      id: '912297733',
      title: '[v2607] String ID',
      version: 3,
      storage: '<p>본문</p>',
    });
  });

  it('refuses to overwrite a page when its version changed', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      id: '1',
      status: 'current',
      title: 'Page',
      spaceId: 'space',
      version: { number: 4 },
      body: { storage: { value: '<p>newer</p>', representation: 'storage' } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const client = new ConfluenceClient('https://krafton.atlassian.net', 'email', 'token', fetchImpl);

    await expect(client.updatePage('1', '<p>ours</p>', 3)).rejects.toThrow('다른 사용자가');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sets both page appearance properties to full width with the correct versions', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      if (!init?.method) {
        return new Response(JSON.stringify({
          results: [{
            key: 'content-appearance-draft',
            value: 'fixed-width',
            version: { number: 3 },
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const client = new ConfluenceClient('https://krafton.atlassian.net', 'email', 'token', fetchImpl);

    await client.setPageFullWidth('1');

    expect(requests.map((request) => [request.init?.method ?? 'GET', request.url])).toEqual([
      ['GET', 'https://krafton.atlassian.net/wiki/rest/api/content/1/property?limit=200'],
      ['PUT', 'https://krafton.atlassian.net/wiki/rest/api/content/1/property/content-appearance-draft'],
      ['PUT', 'https://krafton.atlassian.net/wiki/rest/api/content/1/property/content-appearance-published'],
    ]);
    expect(JSON.parse(String(requests[1].init?.body))).toEqual({
      key: 'content-appearance-draft',
      value: 'full-width',
      version: { number: 4 },
    });
    expect(JSON.parse(String(requests[2].init?.body))).toEqual({
      key: 'content-appearance-published',
      value: 'full-width',
      version: { number: 1 },
    });
  });

  it('uploads a new attachment without exposing the token in the request URL', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ results: [{ id: 'att-1', title: 'frame.png' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const root = await mkdtemp(path.join(tmpdir(), 'string-finder-confluence-'));
    createdPaths.push(root);
    const filePath = path.join(root, 'frame.png');
    await writeFile(filePath, new Uint8Array([1, 2, 3]));
    const client = new ConfluenceClient('https://krafton.atlassian.net', 'email', 'secret-token', fetchImpl);

    await client.uploadAttachment('1', filePath, 'frame.png');

    expect(requests).toHaveLength(2);
    expect(requests[1].url).not.toContain('secret-token');
    expect(requests[1].init?.headers).toMatchObject({ 'X-Atlassian-Token': 'no-check' });
    expect(requests[1].init?.body).toBeInstanceOf(FormData);
  });

  it('reads, creates, and updates an L10N content property with version control', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      if (!init?.method) {
        return new Response(JSON.stringify({
          results: [{
            key: 'string-finder-l10n-sync',
            value: { schemaVersion: 1, rows: [] },
            version: { number: 3 },
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const client = new ConfluenceClient('https://krafton.atlassian.net', 'email', 'token', fetchImpl);

    await expect(client.getContentProperty<{ schemaVersion: number }>(
      '1',
      'string-finder-l10n-sync',
    )).resolves.toEqual({ value: { schemaVersion: 1, rows: [] }, version: 3 });
    await client.setContentProperty('1', 'new-property', { enabled: true });
    await client.setContentProperty('1', 'string-finder-l10n-sync', { schemaVersion: 1 }, 3);

    expect(requests.map((request) => [request.init?.method ?? 'GET', request.url])).toEqual([
      ['GET', 'https://krafton.atlassian.net/wiki/rest/api/content/1/property?limit=200'],
      ['POST', 'https://krafton.atlassian.net/wiki/rest/api/content/1/property'],
      ['PUT', 'https://krafton.atlassian.net/wiki/rest/api/content/1/property/string-finder-l10n-sync'],
    ]);
    expect(JSON.parse(String(requests[1].init?.body))).toEqual({
      key: 'new-property',
      value: { enabled: true },
    });
    expect(JSON.parse(String(requests[2].init?.body))).toEqual({
      key: 'string-finder-l10n-sync',
      value: { schemaVersion: 1 },
      version: { number: 4 },
    });
  });
});
