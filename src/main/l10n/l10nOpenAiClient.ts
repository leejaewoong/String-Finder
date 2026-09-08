import { L10nIssue } from '../../shared/l10nTypes';
import { FigmaScreenContextItem } from './figmaTag';
import { STRING_ID_TYPES, StringIdInference, StringIdType } from './stringIdRules';

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface L10nInferenceRow {
  rowKey: string;
  korean: string;
  english: string;
  frameName: string;
  idHint?: string;
  existingStringId?: string;
  tagLabel?: string;
  layerPath?: string[];
  layerTypes?: string[];
  screenContext?: FigmaScreenContextItem[];
}

export interface L10nInferenceResult {
  inferences: StringIdInference[];
  issues: L10nIssue[];
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

function inferenceIssue(row: L10nInferenceRow, message: string): L10nIssue {
  return {
    code: 'LLM_INFERENCE_FAILED',
    rowKey: row.rowKey,
    frameName: row.frameName,
    korean: row.korean,
    message,
  };
}

function normalizeLayerName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function hasLayerWord(value: string, word: string): boolean {
  return normalizeLayerName(value).split(/\s+/).includes(word);
}

export function inferTypeFromFigmaContext(
  row: L10nInferenceRow,
): StringIdType | undefined {
  const layerPath = row.layerPath ?? [];
  const normalizedPath = layerPath.map(normalizeLayerName);

  if (normalizedPath.some((name) => /\bside tab\b/.test(name))) return 'BUTTON';
  if (normalizedPath.some((name) => /\bcontents? switch\b/.test(name))) return 'BUTTON';

  const titleIndex = layerPath.findIndex((name) => hasLayerWord(name, 'title'));
  const lnbIndex = layerPath.findIndex((name, index) =>
    index > titleIndex && hasLayerWord(name, 'lnb')
  );
  if (titleIndex < 0 || lnbIndex < 0) return undefined;

  if (row.layerTypes?.length) {
    const titleType = row.layerTypes[titleIndex];
    const lnbType = row.layerTypes[lnbIndex];
    if (!['INSTANCE', 'COMPONENT', 'COMPONENT_SET'].includes(titleType)
      || lnbType !== 'FRAME') return undefined;
  }

  const hasButtonName = layerPath.some((name, index) =>
    index > lnbIndex && (hasLayerWord(name, 'button') || hasLayerWord(name, 'btn'))
  );
  const hasButtonInstance = (row.layerTypes ?? []).some((type, index) =>
    index > lnbIndex && index < layerPath.length - 1 && type === 'INSTANCE'
  );
  return hasButtonName || hasButtonInstance ? 'LNB' : undefined;
}

export class L10nOpenAiClient {
  constructor(
    private readonly apiKey: string,
    private readonly model: string = 'gpt-5.6-terra',
    private readonly fetchImpl: FetchLike = fetch,
    private readonly reasoningEffort: string = process.env.OPENAI_REASONING_EFFORT || 'low',
  ) {}

  async infer(
    rows: L10nInferenceRow[],
    featureCandidates: string[],
    signal?: AbortSignal,
  ): Promise<L10nInferenceResult> {
    if (rows.length === 0) return { inferences: [], issues: [] };

    const features = [...new Set(featureCandidates.map((feature) => feature.toUpperCase()))].sort();
    const response = await this.fetchImpl('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        reasoning_effort: this.reasoningEffort,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: [
              'Classify PUBG outgame localization strings for String ID creation.',
              'Return only a JSON object: {"items":[{"rowKey":"...","feature":"...","screen":"...","type":"..."}]}.',
              'Feature is selected by the user: return the exact allowed feature without inferring it.',
              'Do not translate or rewrite text. Use uppercase ASCII identifiers.',
            ].join(' '),
          },
          {
            role: 'user',
            content: [
              `Allowed features: ${features.join(', ')}`,
              `Allowed types: ${STRING_ID_TYPES.join(', ')}`,
              'For type, use canonical component and layer context first. Side Tab and Contents Switch are BUTTON.',
              'LNB is only a button inside the LNB auto-layout of a Title component. Existing IDs and hints are weak evidence.',
              'Infer screen using this evidence order: active TAB, active LNB, TITLE, GLOBAL HEADER, frame name, then target layer path.',
              'Treat selected, active, on, checked, state, and variant properties in screenContext as component state evidence.',
              'Use Korean, English, and the optional ID hint only after the Figma screen context.',
              JSON.stringify(rows),
            ].join('\n'),
          },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`OpenAI API 요청에 실패했습니다: ${response.status} ${detail.slice(0, 200)}`);
    }

    const payload = await response.json() as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content;
    let items: unknown[];
    try {
      const parsed = JSON.parse(content ?? '') as { items?: unknown[] };
      if (!Array.isArray(parsed.items)) throw new Error('items is missing');
      items = parsed.items;
    } catch {
      return {
        inferences: [],
        issues: rows.map((row) => inferenceIssue(
          row,
          'String ID 분류 응답을 해석하지 못했습니다.',
        )),
      };
    }

    const requestedRows = new Map(rows.map((row) => [row.rowKey, row]));
    const accepted = new Map<string, StringIdInference>();
    const issues: L10nIssue[] = [];
    for (const rawItem of items) {
      if (!rawItem || typeof rawItem !== 'object') continue;
      const item = rawItem as Record<string, unknown>;
      const rowKey = typeof item.rowKey === 'string' ? item.rowKey : '';
      if (!requestedRows.has(rowKey) || accepted.has(rowKey)) continue;
      const feature = typeof item.feature === 'string' ? item.feature.toUpperCase() : '';
      const screen = typeof item.screen === 'string' ? item.screen.toUpperCase() : '';
      const type = typeof item.type === 'string' ? item.type.toUpperCase() : '';
      const resolvedType = inferTypeFromFigmaContext(requestedRows.get(rowKey)!)
        ?? type as StringIdType;
      const valid = features.includes(feature)
        && /^[A-Z0-9_]+$/.test(screen)
        && STRING_ID_TYPES.includes(resolvedType);
      if (!valid) {
        issues.push(inferenceIssue(
          requestedRows.get(rowKey)!,
          '피처, 화면 또는 Type 분류값이 허용 범위와 다릅니다.',
        ));
        continue;
      }
      accepted.set(rowKey, {
        rowKey,
        feature,
        screen,
        type: resolvedType,
      });
    }

    for (const row of rows) {
      if (!accepted.has(row.rowKey) && !issues.some((issue) => issue.rowKey === row.rowKey)) {
        issues.push(inferenceIssue(row, 'String ID 분류 결과에서 항목을 찾지 못했습니다.'));
      }
    }
    return { inferences: [...accepted.values()], issues };
  }
}
