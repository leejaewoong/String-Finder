import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../logUtil', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('OpenAIService', () => {
  it('uses the common Terra model and low reasoning request contract', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-token');
    vi.stubEnv('OPENAI_MODEL', 'gpt-5.6-terra');
    vi.stubEnv('OPENAI_REASONING_EFFORT', 'low');
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('gpt-5.6-terra');
      expect(body.reasoning_effort).toBe('low');
      expect(body.max_completion_tokens).toBe(300);
      expect(body.max_tokens).toBeUndefined();
      expect(body.temperature).toBeUndefined();
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({ keywords: ['play'], synonyms: ['start'] }),
          },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchImpl);

    const { openaiService } = await import('../openaiService');
    const result = await openaiService.getSynonyms('play', 'en');

    expect(result).toEqual(['start']);
  });

  it('uses environment values reloaded after the service was created', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-token');
    vi.stubEnv('OPENAI_MODEL', 'legacy-model');
    vi.stubEnv('OPENAI_REASONING_EFFORT', 'none');
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('gpt-5.6-terra');
      expect(body.reasoning_effort).toBe('low');
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({ keywords: ['play'], synonyms: ['start'] }),
          },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchImpl);
    const { openaiService } = await import('../openaiService');

    vi.stubEnv('OPENAI_MODEL', 'gpt-5.6-terra');
    vi.stubEnv('OPENAI_REASONING_EFFORT', 'low');
    const result = await openaiService.getSynonyms('play', 'en');

    expect(result).toEqual(['start']);
  });
});
