import { L10nIssue } from '../../shared/l10nTypes';
import { STRING_ID_TYPES, StringIdInference, StringIdType } from './stringIdRules';

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface L10nInferenceRow {
  rowKey: string;
  korean: string;
  english: string;
  frameName: string;
  idHint?: string;
}

export interface L10nInferenceResult {
  inferences: StringIdInference[];
  issues: L10nIssue[];
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

function inferenceIssue(rowKey: string, message: string): L10nIssue {
  return { code: 'LLM_INFERENCE_FAILED', rowKey, message };
}

export class L10nOpenAiClient {
  constructor(
    private readonly apiKey: string,
    private readonly model: string = 'gpt-4o-mini',
    private readonly fetchImpl: FetchLike = fetch,
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
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: [
              'Classify PUBG outgame localization strings for String ID creation.',
              'Return only a JSON object: {"items":[{"rowKey":"...","feature":"...","screen":"...","type":"..."}]}.',
              'Do not translate or rewrite text. Use uppercase ASCII identifiers.',
            ].join(' '),
          },
          {
            role: 'user',
            content: [
              `Allowed features: ${features.join(', ')}`,
              `Allowed types: ${STRING_ID_TYPES.join(', ')}`,
              'Infer screen from the frame, Korean, English, and optional ID hint.',
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
          row.rowKey,
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
      const valid = features.includes(feature)
        && /^[A-Z0-9_]+$/.test(screen)
        && STRING_ID_TYPES.includes(type as StringIdType);
      if (!valid) {
        issues.push(inferenceIssue(rowKey, '피처, 화면 또는 Type 분류값이 허용 범위와 다릅니다.'));
        continue;
      }
      accepted.set(rowKey, {
        rowKey,
        feature,
        screen,
        type: type as StringIdType,
      });
    }

    for (const row of rows) {
      if (!accepted.has(row.rowKey) && !issues.some((issue) => issue.rowKey === row.rowKey)) {
        issues.push(inferenceIssue(row.rowKey, 'String ID 분류 결과에서 항목을 찾지 못했습니다.'));
      }
    }
    return { inferences: [...accepted.values()], issues };
  }
}
