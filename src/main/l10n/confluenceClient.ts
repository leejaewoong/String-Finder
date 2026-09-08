import { readFile } from 'fs/promises';

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface ConfluenceV2PageResponse {
  id: string;
  status: string;
  title: string;
  spaceId: string;
  version: { number: number };
  body: { storage: { value: string; representation: string } };
}

interface AttachmentListResponse {
  results: Array<{ id: string; title: string }>;
}

interface ContentPropertyListResponse {
  results: Array<ContentPropertyResponse>;
}

interface ContentPropertyResponse {
  key: string;
  value: unknown;
  version: { number: number };
}

interface ChildPageListResponse {
  results: Array<{
    id: string;
    title: string;
    version?: { number: number };
    body?: { storage?: { value?: string } };
  }>;
}

export interface ConfluencePage {
  id: string;
  status: string;
  title: string;
  spaceId: string;
  version: number;
  storage: string;
}

export interface ConfluenceChildPage {
  id: string;
  title: string;
  version: number;
  storage: string;
}

export interface ConfluenceContentProperty<T> {
  value: T;
  version: number;
}

export function parseConfluencePageUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('올바른 Confluence URL이 아닙니다.');
  }

  const pageMatch = parsed.pathname.match(/\/pages\/(\d+)/);
  const pageId = pageMatch?.[1] ?? parsed.searchParams.get('pageId');
  if (!pageId || !/^\d+$/.test(pageId)) {
    throw new Error('Confluence URL에서 페이지 ID를 찾을 수 없습니다.');
  }
  return pageId;
}

export class ConfluenceClient {
  private readonly baseUrl: string;
  private readonly authorization: string;

  constructor(
    baseUrl: string,
    email: string,
    token: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.authorization = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
  }

  async getPage(pageId: string, signal?: AbortSignal): Promise<ConfluencePage> {
    const response = await this.request(
      `/wiki/api/v2/pages/${encodeURIComponent(pageId)}?body-format=storage`,
      { signal },
    );
    const payload = await response.json() as ConfluenceV2PageResponse;
    return {
      id: payload.id,
      status: payload.status,
      title: payload.title,
      spaceId: payload.spaceId,
      version: payload.version.number,
      storage: payload.body.storage.value,
    };
  }

  async updatePage(
    pageId: string,
    storage: string,
    expectedVersion: number,
    signal?: AbortSignal,
  ): Promise<ConfluencePage> {
    const latest = await this.getPage(pageId, signal);
    if (latest.version !== expectedVersion) {
      throw new Error('다른 사용자가 위키 페이지를 수정했습니다. 페이지를 다시 확인해 주세요.');
    }

    const response = await this.request(`/wiki/api/v2/pages/${encodeURIComponent(pageId)}`, {
      method: 'PUT',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: latest.id,
        status: latest.status || 'current',
        title: latest.title,
        spaceId: latest.spaceId,
        body: { representation: 'storage', value: storage },
        version: {
          number: latest.version + 1,
          message: 'String-Finder L10N 자동화',
        },
      }),
    });
    const payload = await response.json() as ConfluenceV2PageResponse;
    return {
      id: payload.id,
      status: payload.status,
      title: payload.title,
      spaceId: payload.spaceId,
      version: payload.version.number,
      storage: payload.body.storage.value,
    };
  }

  async setPageFullWidth(pageId: string, signal?: AbortSignal): Promise<void> {
    const response = await this.request(
      `/wiki/rest/api/content/${encodeURIComponent(pageId)}/property?limit=200`,
      { signal },
    );
    const payload = await response.json() as ContentPropertyListResponse;
    const properties = new Map(payload.results.map((property) => [property.key, property]));

    for (const key of ['content-appearance-draft', 'content-appearance-published']) {
      const property = properties.get(key);
      if (property?.value === 'full-width') continue;

      await this.request(
        `/wiki/rest/api/content/${encodeURIComponent(pageId)}/property/${encodeURIComponent(key)}`,
        {
          method: 'PUT',
          signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key,
            value: 'full-width',
            version: { number: (property?.version.number ?? 0) + 1 },
          }),
        },
      );
    }
  }

  async getContentProperty<T>(
    pageId: string,
    key: string,
    signal?: AbortSignal,
  ): Promise<ConfluenceContentProperty<T> | undefined> {
    const response = await this.request(
      `/wiki/rest/api/content/${encodeURIComponent(pageId)}/property?limit=200`,
      { signal },
    );
    const payload = await response.json() as ContentPropertyListResponse;
    const property = payload.results.find((item) => item.key === key);
    if (!property) return undefined;
    return {
      value: property.value as T,
      version: property.version.number,
    };
  }

  async setContentProperty(
    pageId: string,
    key: string,
    value: unknown,
    currentVersion?: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const isUpdate = currentVersion !== undefined;
    await this.request(
      isUpdate
        ? `/wiki/rest/api/content/${encodeURIComponent(pageId)}/property/${encodeURIComponent(key)}`
        : `/wiki/rest/api/content/${encodeURIComponent(pageId)}/property`,
      {
        method: isUpdate ? 'PUT' : 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key,
          value,
          ...(isUpdate ? { version: { number: currentVersion + 1 } } : {}),
        }),
      },
    );
  }

  async uploadAttachment(
    pageId: string,
    filePath: string,
    fileName: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const listResponse = await this.request(
      `/wiki/rest/api/content/${encodeURIComponent(pageId)}/child/attachment?filename=${encodeURIComponent(fileName)}&limit=1`,
      { signal },
    );
    const list = await listResponse.json() as AttachmentListResponse;
    const existing = list.results[0];
    const endpoint = existing
      ? `/wiki/rest/api/content/${encodeURIComponent(pageId)}/child/attachment/${encodeURIComponent(existing.id)}/data`
      : `/wiki/rest/api/content/${encodeURIComponent(pageId)}/child/attachment`;

    const fileBuffer = await readFile(filePath);
    const fileBytes = new Uint8Array(fileBuffer.byteLength);
    fileBytes.set(fileBuffer);
    const form = new FormData();
    form.append('file', new Blob([fileBytes], { type: 'image/png' }), fileName);
    await this.request(endpoint, {
      method: 'POST',
      signal,
      headers: { 'X-Atlassian-Token': 'no-check' },
      body: form,
    });
  }

  async getChildPages(parentPageId: string, signal?: AbortSignal): Promise<ConfluenceChildPage[]> {
    const response = await this.request(
      `/wiki/rest/api/content/${encodeURIComponent(parentPageId)}/child/page?limit=200&expand=body.storage,version`,
      { signal },
    );
    const payload = await response.json() as ChildPageListResponse;
    return payload.results.map((page) => ({
      id: page.id,
      title: page.title,
      version: page.version?.number ?? 0,
      storage: page.body?.storage?.value ?? '',
    }));
  }

  private async request(endpoint: string, init: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: this.authorization,
      ...(init.headers as Record<string, string> | undefined),
    };
    const response = await this.fetchImpl(`${this.baseUrl}${endpoint}`, { ...init, headers });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Confluence API 요청에 실패했습니다: ${response.status} ${detail.slice(0, 200)}`);
    }
    return response;
  }
}
