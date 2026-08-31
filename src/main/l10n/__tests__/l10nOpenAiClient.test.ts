import { describe, expect, it, vi } from 'vitest';
import { L10nOpenAiClient } from '../l10nOpenAiClient';

describe('L10nOpenAiClient', () => {
  it('requests a bounded JSON classification and validates rows independently', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer openai-token' });
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('test-model');
      expect(body.response_format).toEqual({ type: 'json_object' });
      expect(body.messages[1].content).toContain('CLAN, DEV');
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              items: [
                { rowKey: 'a', feature: 'CLAN', screen: 'MAIN', type: 'BUTTON' },
                { rowKey: 'b', feature: 'UNKNOWN', screen: 'MAIN', type: 'BUTTON' },
              ],
            }),
          },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const client = new L10nOpenAiClient('openai-token', 'test-model', fetchImpl);

    const result = await client.infer([
      { rowKey: 'a', korean: '플레이', english: 'PLAY', frameName: '메인' },
      { rowKey: 'b', korean: '중지', english: 'STOP', frameName: '메인' },
    ], ['CLAN', 'DEV']);

    expect(result.inferences).toEqual([
      { rowKey: 'a', feature: 'CLAN', screen: 'MAIN', type: 'BUTTON' },
    ]);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'LLM_INFERENCE_FAILED', rowKey: 'b' }),
    ]);
  });

  it('returns row issues when the response is not valid JSON', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'not json' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const client = new L10nOpenAiClient('openai-token', 'test-model', fetchImpl);

    const result = await client.infer([
      { rowKey: 'a', korean: '플레이', english: 'PLAY', frameName: '메인' },
    ], ['CLAN']);

    expect(result.inferences).toEqual([]);
    expect(result.issues[0]).toMatchObject({ code: 'LLM_INFERENCE_FAILED', rowKey: 'a' });
  });
});
