import { mkdir, writeFile } from 'fs/promises';
import * as path from 'path';
import { L10nIssue } from '../../shared/l10nTypes';
import {
  buildNodeIndex,
  collectStringTagLocators,
  FigmaBoundingBox,
  FigmaNode,
  FigmaTaggedString,
  parseFigmaUrl,
  scanStringTags,
} from './figmaTag';

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface FigmaNodesResponse {
  name?: string;
  nodes: Record<string, { document: FigmaNode } | null>;
}

interface FigmaFileResponse {
  name: string;
  document: FigmaNode;
}

interface FigmaImagesResponse {
  images: Record<string, string | null>;
  err?: string;
}

export interface FigmaScannedFrame {
  id: string;
  name: string;
  bounds?: FigmaBoundingBox;
  fileKey: string;
  fileTitle: string;
  attachmentName: string;
  strings: FigmaTaggedString[];
}

export interface FigmaScanResult {
  fileTitles: string[];
  frames: FigmaScannedFrame[];
  issues: L10nIssue[];
}

function containsBounds(container?: FigmaBoundingBox, child?: FigmaBoundingBox): boolean {
  if (!container || !child) return false;
  return child.x >= container.x
    && child.y >= container.y
    && child.x + child.width <= container.x + container.width
    && child.y + child.height <= container.y + container.height;
}

function addExternalTarget(root: FigmaNode, target: FigmaNode): void {
  const frames: FigmaNode[] = [];
  const visit = (node: FigmaNode) => {
    if (node.type === 'FRAME' && containsBounds(node.absoluteBoundingBox, target.absoluteBoundingBox)) {
      frames.push(node);
    }
    node.children?.forEach(visit);
  };
  visit(root);

  frames.sort((a, b) => {
    const areaA = (a.absoluteBoundingBox?.width ?? Infinity) * (a.absoluteBoundingBox?.height ?? Infinity);
    const areaB = (b.absoluteBoundingBox?.width ?? Infinity) * (b.absoluteBoundingBox?.height ?? Infinity);
    return areaA - areaB;
  });
  const parent = frames[0] ?? root;
  parent.children = [...(parent.children ?? []), target];
}

function compareFrames(a: FigmaScannedFrame, b: FigmaScannedFrame): number {
  if (!a.bounds && !b.bounds) return 0;
  if (!a.bounds) return 1;
  if (!b.bounds) return -1;
  return a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x;
}

export class FigmaClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async scan(urls: string[], signal?: AbortSignal): Promise<FigmaScanResult> {
    const frames = new Map<string, FigmaScannedFrame>();
    const fileTitles = new Set<string>();
    const issues: L10nIssue[] = [];
    const seenSources = new Set<string>();

    for (const url of urls) {
      const source = parseFigmaUrl(url);
      const sourceKey = `${source.fileKey}:${source.nodeId ?? 'document'}`;
      if (seenSources.has(sourceKey)) continue;
      seenSources.add(sourceKey);

      const { title, root } = await this.loadSource(source.fileKey, source.nodeId, signal);
      fileTitles.add(title);
      await this.loadMissingTargets(source.fileKey, root, signal);
      const scanned = scanStringTags(root);
      issues.push(...scanned.issues);

      for (const frame of scanned.frames) {
        const key = `${source.fileKey}:${frame.id}`;
        const matchingStrings = scanned.strings.filter((item) => item.frame.id === frame.id);
        const existing = frames.get(key);
        if (existing) {
          const existingKeys = new Set(existing.strings.map((item) => item.tagNodeId));
          existing.strings.push(...matchingStrings.filter((item) => !existingKeys.has(item.tagNodeId)));
          continue;
        }

        frames.set(key, {
          ...frame,
          fileKey: source.fileKey,
          fileTitle: title,
          attachmentName: `string-finder-${source.fileKey}-${frame.id.replace(/[^A-Za-z0-9_-]/g, '_')}.png`,
          strings: matchingStrings,
        });
      }
    }

    return {
      fileTitles: [...fileTitles],
      frames: [...frames.values()].sort(compareFrames),
      issues,
    };
  }

  async exportFrame(
    fileKey: string,
    frameId: string,
    outputPath: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const query = new URLSearchParams({ ids: frameId, format: 'png', scale: '1' });
    const response = await this.request(
      `https://api.figma.com/v1/images/${encodeURIComponent(fileKey)}?${query.toString()}`,
      signal,
    );
    const payload = await response.json() as FigmaImagesResponse;
    const imageUrl = payload.images[frameId];
    if (!imageUrl) {
      throw new Error(payload.err || `Figma 프레임 이미지를 생성하지 못했습니다: ${frameId}`);
    }

    const imageResponse = await this.fetchImpl(imageUrl, { signal });
    if (!imageResponse.ok) {
      throw new Error(`Figma 프레임 이미지 다운로드에 실패했습니다: ${imageResponse.status}`);
    }

    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, Buffer.from(await imageResponse.arrayBuffer()));
  }

  private async loadSource(
    fileKey: string,
    nodeId?: string,
    signal?: AbortSignal,
  ): Promise<{ title: string; root: FigmaNode }> {
    if (nodeId) {
      const query = new URLSearchParams({ ids: nodeId });
      const response = await this.request(
        `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/nodes?${query.toString()}`,
        signal,
      );
      const payload = await response.json() as FigmaNodesResponse;
      const root = payload.nodes[nodeId]?.document;
      if (!root) {
        throw new Error(`Figma 선택 노드를 찾을 수 없습니다: ${nodeId}`);
      }
      return { title: payload.name ?? fileKey, root };
    }

    const response = await this.request(
      `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}`,
      signal,
    );
    const payload = await response.json() as FigmaFileResponse;
    return { title: payload.name, root: payload.document };
  }

  private async loadMissingTargets(
    fileKey: string,
    root: FigmaNode,
    signal?: AbortSignal,
  ): Promise<void> {
    const index = buildNodeIndex(root);
    const missing = collectStringTagLocators(root).filter((locator) => !index.nodes.has(locator));
    if (missing.length === 0) return;

    const query = new URLSearchParams({ ids: missing.join(',') });
    const response = await this.request(
      `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/nodes?${query.toString()}`,
      signal,
    );
    const payload = await response.json() as FigmaNodesResponse;
    for (const locator of missing) {
      const target = payload.nodes[locator]?.document;
      if (target) {
        addExternalTarget(root, target);
      }
    }
  }

  private async request(url: string, signal?: AbortSignal): Promise<Response> {
    const response = await this.fetchImpl(url, {
      headers: { 'X-Figma-Token': this.token },
      signal,
    });
    if (!response.ok) {
      throw new Error(`Figma API 요청에 실패했습니다: ${response.status} ${response.statusText}`);
    }
    return response;
  }
}
