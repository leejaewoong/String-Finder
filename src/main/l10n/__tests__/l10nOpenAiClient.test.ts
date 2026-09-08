import { describe, expect, it, vi } from 'vitest';
import { inferTypeFromFigmaContext, L10nOpenAiClient } from '../l10nOpenAiClient';

describe('inferTypeFromFigmaContext', () => {
  it('classifies Side Tab and Contents Switch as BUTTON', () => {
    expect(inferTypeFromFigmaContext({
      rowKey: 'side-tab', korean: '', english: '', frameName: '',
      layerPath: ['Title', 'Side Tab', 'Label'],
    })).toBe('BUTTON');
    expect(inferTypeFromFigmaContext({
      rowKey: 'contents-switch', korean: '', english: '', frameName: '',
      layerPath: ['Panel', 'Contents Switch', 'Button', 'Text'],
    })).toBe('BUTTON');
  });

  it('classifies only a button instance inside Title LNB as LNB', () => {
    expect(inferTypeFromFigmaContext({
      rowKey: 'lnb', korean: '', english: '', frameName: '',
      layerPath: ['Title', 'LNB', 'Menu item', 'Text'],
      layerTypes: ['INSTANCE', 'FRAME', 'INSTANCE', 'TEXT'],
    })).toBe('LNB');
    expect(inferTypeFromFigmaContext({
      rowKey: 'outside-title', korean: '', english: '', frameName: '',
      layerPath: ['Panel', 'LNB', 'Button', 'Text'],
      layerTypes: ['FRAME', 'FRAME', 'INSTANCE', 'TEXT'],
    })).toBeUndefined();
    expect(inferTypeFromFigmaContext({
      rowKey: 'not-button', korean: '', english: '', frameName: '',
      layerPath: ['Title', 'LNB', 'Description'],
      layerTypes: ['INSTANCE', 'FRAME', 'TEXT'],
    })).toBeUndefined();
    expect(inferTypeFromFigmaContext({
      rowKey: 'title-frame', korean: '', english: '', frameName: '',
      layerPath: ['Title', 'LNB', 'Button', 'Text'],
      layerTypes: ['FRAME', 'FRAME', 'INSTANCE', 'TEXT'],
    })).toBeUndefined();
  });
});

describe('L10nOpenAiClient', () => {
  it('requests a bounded JSON classification and validates rows independently', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer openai-token' });
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('test-model');
      expect(body.reasoning_effort).toBe('low');
      expect(body.temperature).toBeUndefined();
      expect(body.response_format).toEqual({ type: 'json_object' });
      expect(body.messages[1].content).toContain('CLAN, DEV');
      expect(body.messages[1].content).toContain('active TAB');
      expect(body.messages[1].content).toContain('Selected');
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              items: [
                { rowKey: 'a', feature: 'CLAN', screen: 'MAIN', type: 'BUTTON' },
                { rowKey: 'b', feature: 'UNKNOWN', screen: 'MAIN', type: 'BUTTON' },
                { rowKey: 'c', feature: 'CLAN', screen: 'MAIN', type: 'BODY' },
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
      {
        rowKey: 'c', korean: '카테고리', english: 'CATEGORY', frameName: '메인',
        layerPath: ['Panel', 'Side Tab', 'Label'],
        screenContext: [{
          name: 'Tab Item',
          type: 'INSTANCE',
          path: ['Main', 'Tab', 'Tab Item'],
          text: 'Challenge',
          states: { Selected: true },
        }],
      },
    ], ['CLAN', 'DEV']);

    expect(result.inferences).toEqual([
      { rowKey: 'a', feature: 'CLAN', screen: 'MAIN', type: 'BUTTON' },
      { rowKey: 'c', feature: 'CLAN', screen: 'MAIN', type: 'BUTTON' },
    ]);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'LLM_INFERENCE_FAILED', rowKey: 'b' }),
    ]);
  });

  it('uses Terra with low reasoning when configuration is omitted', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('gpt-5.6-terra');
      expect(body.reasoning_effort).toBe('low');
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              items: [{ rowKey: 'a', feature: 'CLAN', screen: 'MAIN', type: 'BUTTON' }],
            }),
          },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const client = new L10nOpenAiClient('openai-token', undefined, fetchImpl);

    const result = await client.infer([
      { rowKey: 'a', korean: '플레이', english: 'PLAY', frameName: '메인' },
    ], ['CLAN']);

    expect(result.inferences).toHaveLength(1);
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
