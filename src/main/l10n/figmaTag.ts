import { L10nIssue } from '../../shared/l10nTypes';

export interface FigmaBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FigmaComponentProperty {
  type?: string;
  value: string | boolean;
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  characters?: string;
  children?: FigmaNode[];
  componentProperties?: Record<string, FigmaComponentProperty>;
  absoluteBoundingBox?: FigmaBoundingBox;
  visible?: boolean;
}

export interface FigmaScreenContextItem {
  name: string;
  type: string;
  path: string[];
  text?: string;
  states?: Record<string, string | boolean>;
}

export interface ParsedStringTag {
  delimiter: string;
  label: string;
  locator: string;
  stringIdHint: string;
}

export interface FigmaFrameRef {
  id: string;
  name: string;
  bounds?: FigmaBoundingBox;
}

export interface FigmaTaggedString extends ParsedStringTag {
  tagNodeId: string;
  targetNodeId: string;
  korean: string;
  frame: FigmaFrameRef;
  layerPath: string[];
  layerTypes?: string[];
  screenContext?: FigmaScreenContextItem[];
}

export interface FigmaTagScanResult {
  strings: FigmaTaggedString[];
  frames: FigmaFrameRef[];
  issues: L10nIssue[];
}

interface FigmaNodeIndex {
  nodes: Map<string, FigmaNode>;
  parents: Map<string, string>;
}

export function parseFigmaUrl(url: string): { fileKey: string; nodeId?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('올바른 Figma URL이 아닙니다.');
  }

  if (!/(^|\.)figma\.com$/i.test(parsed.hostname)) {
    throw new Error('올바른 Figma URL이 아닙니다.');
  }

  const pathMatch = parsed.pathname.match(/^\/(?:design|file)\/([^/]+)/i);
  if (!pathMatch) {
    throw new Error('Figma URL에서 파일 키를 찾을 수 없습니다.');
  }

  const rawNodeId = parsed.searchParams.get('node-id')?.trim();
  return {
    fileKey: pathMatch[1],
    ...(rawNodeId ? { nodeId: rawNodeId.replace(/-/g, ':') } : {}),
  };
}

export function parseStringTagName(name: string): ParsedStringTag | null {
  if (!name.includes('%stringTag')) {
    return null;
  }

  const payloadMatch = name.match(/\(%stringTag\^([^)]*)\)/);
  if (!payloadMatch) {
    throw new Error(`스트링 태그 형식이 올바르지 않습니다: ${name}`);
  }

  const fields = payloadMatch[1].split('^');
  if (fields.length !== 4 || fields.some((field) => !field.trim())) {
    throw new Error(`스트링 태그 payload가 올바르지 않습니다: ${name}`);
  }

  const [delimiter, label, locator, stringIdHint] = fields.map((field) => field.trim());
  return { delimiter, label, locator, stringIdHint };
}

export function buildNodeIndex(root: FigmaNode): FigmaNodeIndex {
  const nodes = new Map<string, FigmaNode>();
  const parents = new Map<string, string>();

  const visit = (node: FigmaNode, parentId?: string) => {
    nodes.set(node.id, node);
    if (parentId) {
      parents.set(node.id, parentId);
    }
    node.children?.forEach((child) => visit(child, node.id));
  };

  visit(root);
  return { nodes, parents };
}

export function collectStringTagLocators(root: FigmaNode): string[] {
  const locators = new Set<string>();
  const visit = (node: FigmaNode) => {
    try {
      const parsed = parseStringTagName(node.name);
      if (parsed) {
        locators.add(parsed.locator);
      }
    } catch {
      // scanStringTags reports malformed tags with their node context.
    }
    node.children?.forEach(visit);
  };
  visit(root);
  return [...locators];
}

export function selectExportFrame(
  tagNodeId: string,
  targetNodeId: string,
  index: FigmaNodeIndex,
): FigmaNode | null {
  const tagAncestors = new Set<string>();
  let tagCursor: string | undefined = tagNodeId;
  while (tagCursor) {
    tagAncestors.add(tagCursor);
    tagCursor = index.parents.get(tagCursor);
  }

  let targetCursor: string | undefined = targetNodeId;
  while (targetCursor) {
    const node = index.nodes.get(targetCursor);
    if (node?.type === 'FRAME' && tagAncestors.has(node.id)) {
      return node;
    }
    targetCursor = index.parents.get(targetCursor);
  }

  return null;
}

function getNodeText(node: FigmaNode): string | null {
  if (node.type === 'TEXT' && node.characters?.trim()) {
    return node.characters.trim();
  }

  const textProperty = Object.entries(node.componentProperties ?? {})
    .find(([key, property]) =>
      key.toLowerCase().replace(/#.*/, '') === 'text' && typeof property.value === 'string'
    )?.[1];
  if (textProperty && typeof textProperty.value === 'string' && textProperty.value.trim()) {
    return textProperty.value.trim();
  }

  for (const child of node.children ?? []) {
    const childText = getNodeText(child);
    if (childText) {
      return childText;
    }
  }

  return null;
}

function getLayerContext(
  nodeId: string,
  index: FigmaNodeIndex,
): { layerPath: string[]; layerTypes: string[] } {
  const layerPath: string[] = [];
  const layerTypes: string[] = [];
  let cursor: string | undefined = nodeId;
  while (cursor) {
    const node = index.nodes.get(cursor);
    if (node) {
      layerPath.unshift(node.name);
      layerTypes.unshift(node.type);
    }
    cursor = index.parents.get(cursor);
  }
  return { layerPath, layerTypes };
}

function isScreenContextNode(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return /\btab\b/.test(normalized)
    || /\btitle\b/.test(normalized)
    || /\blnb\b/.test(normalized)
    || /\bglobal header\b/.test(normalized);
}

function collectScreenContext(
  frameNode: FigmaNode,
  index: FigmaNodeIndex,
): FigmaScreenContextItem[] {
  const context: FigmaScreenContextItem[] = [];
  const visit = (node: FigmaNode) => {
    if (node.visible !== false && isScreenContextNode(node.name)) {
      const states = Object.fromEntries(Object.entries(node.componentProperties ?? {})
        .map(([key, property]) => [key.replace(/#.*/, ''), property.value]));
      const text = getNodeText(node);
      context.push({
        name: node.name,
        type: node.type,
        path: getLayerContext(node.id, index).layerPath,
        ...(text ? { text } : {}),
        ...(Object.keys(states).length > 0 ? { states } : {}),
      });
    }
    node.children?.forEach(visit);
  };
  visit(frameNode);
  return context;
}

function compareBounds(a?: FigmaBoundingBox, b?: FigmaBoundingBox): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.y - b.y || a.x - b.x;
}

export function scanStringTags(root: FigmaNode): FigmaTagScanResult {
  const index = buildNodeIndex(root);
  const strings: FigmaTaggedString[] = [];
  const issues: L10nIssue[] = [];
  const seenTargetNodeIds = new Set<string>();
  const screenContextByFrame = new Map<string, FigmaScreenContextItem[]>();

  for (const tagNode of index.nodes.values()) {
    let parsed: ParsedStringTag | null;
    try {
      parsed = parseStringTagName(tagNode.name);
    } catch (error) {
      const frameNode = selectExportFrame(tagNode.id, tagNode.id, index);
      issues.push({
        code: 'FIGMA_TAG_INVALID',
        message: error instanceof Error ? error.message : String(error),
        rowKey: tagNode.id,
        frameName: frameNode?.name,
      });
      continue;
    }

    if (!parsed) {
      continue;
    }

    const targetNode = index.nodes.get(parsed.locator);
    if (!targetNode) {
      issues.push({
        code: 'FIGMA_TARGET_MISSING',
        message: `구분자 ${parsed.delimiter}의 타겟 노드를 찾을 수 없습니다.`,
        rowKey: tagNode.id,
        delimiter: parsed.delimiter,
      });
      continue;
    }

    const korean = getNodeText(targetNode);
    const frameNode = selectExportFrame(tagNode.id, targetNode.id, index);
    if (!korean || !frameNode) {
      issues.push({
        code: 'FIGMA_TARGET_MISSING',
        message: `구분자 ${parsed.delimiter}의 텍스트 또는 내보낼 프레임을 찾을 수 없습니다.`,
        rowKey: tagNode.id,
        delimiter: parsed.delimiter,
        frameName: frameNode?.name,
        korean: korean ?? undefined,
      });
      continue;
    }

    if (seenTargetNodeIds.has(targetNode.id)) {
      issues.push({
        code: 'FIGMA_TARGET_DUPLICATE',
        message: `구분자 ${parsed.delimiter}가 이미 다른 태그에서 사용하는 타겟 노드를 가리킵니다.`,
        rowKey: tagNode.id,
        delimiter: parsed.delimiter,
        frameName: frameNode.name,
        korean,
      });
      continue;
    }
    seenTargetNodeIds.add(targetNode.id);

    const layerContext = getLayerContext(targetNode.id, index);
    let screenContext = screenContextByFrame.get(frameNode.id);
    if (!screenContext) {
      screenContext = collectScreenContext(frameNode, index);
      screenContextByFrame.set(frameNode.id, screenContext);
    }
    strings.push({
      ...parsed,
      tagNodeId: tagNode.id,
      targetNodeId: targetNode.id,
      korean,
      frame: {
        id: frameNode.id,
        name: frameNode.name,
        bounds: frameNode.absoluteBoundingBox,
      },
      ...layerContext,
      screenContext,
    });
  }

  const frameMap = new Map<string, FigmaFrameRef>();
  strings.forEach((item) => frameMap.set(item.frame.id, item.frame));
  const frames = [...frameMap.values()].sort((a, b) => compareBounds(a.bounds, b.bounds));
  const frameOrder = new Map(frames.map((frame, indexValue) => [frame.id, indexValue]));

  strings.sort((a, b) =>
    (frameOrder.get(a.frame.id) ?? 0) - (frameOrder.get(b.frame.id) ?? 0)
    || a.delimiter.localeCompare(b.delimiter, undefined, { numeric: true })
  );

  return { strings, frames, issues };
}
