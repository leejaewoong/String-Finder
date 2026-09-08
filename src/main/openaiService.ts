import * as dotenv from 'dotenv';
import { logInfo, logError } from './logUtil';

// .env 파일 로드
dotenv.config();

interface PredictedTranslation {
  language: string;
  value: string;
}

// 지원하는 언어 목록
const SUPPORTED_LANGUAGES = [
  'ar', 'ca', 'en', 'de', 'es', 'es-MX', 'fr', 'ga-IE', 'hi', 'id', 'it',
  'ja', 'ko', 'ku', 'pl', 'pt', 'pt-BR', 'ru', 'th', 'tr', 'uk',
  'ur', 'vi', 'zh', 'zh-CN', 'zh-TW'
];

class OpenAIService {
  private modelOverride?: string;

  constructor() {
    logInfo('[OpenAI] Constructor called');
    logInfo('[OpenAI] API Key exists:', !!process.env.OPENAI_API_KEY);
    logInfo('[OpenAI] Using model:', this.getModel());
  }

  private getModel(): string {
    return this.modelOverride || process.env.OPENAI_MODEL || 'gpt-5.6-terra';
  }

  private getReasoningEffort(): string {
    return process.env.OPENAI_REASONING_EFFORT || 'low';
  }

  private getApiKey(): string {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      logError('[OpenAI] API Key not found in process.env');
      logError('[OpenAI] Available env vars:', Object.keys(process.env).filter(k => k.includes('OPENAI')));
      throw new Error('OpenAI API 키가 설정되지 않았습니다.');
    }
    return apiKey;
  }

  async getPredictedTranslations(text: string): Promise<PredictedTranslation[]> {
    const apiKey = this.getApiKey();

    try {
      // 언어 코드 목록 생성
      const langCodes = SUPPORTED_LANGUAGES.join(', ');

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.getModel(),
          messages: [
            {
              role: 'system',
              content: 'You are a professional game UI localization expert. Translate text to multiple languages following game industry localization standards and UI text conventions. Always respond with valid JSON only.'
            },
            {
              role: 'user',
              content: `Translate the following text to all supported languages (${langCodes}):\n\n"${text}"\n\nRespond with a JSON object where keys are language codes and values are translations. Example: {"ko":"번역","ja":"翻訳",...}`
            }
          ],
          reasoning_effort: this.getReasoningEffort(),
          max_completion_tokens: 1500,
          response_format: { type: "json_object" },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`OpenAI API 오류: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content;

      if (!content) {
        throw new Error('OpenAI로부터 응답을 받지 못했습니다.');
      }

      logInfo('[OpenAI] Raw response:', content.substring(0, 200));

      // JSON 파싱 시도
      let translationsObj: any;
      try {
        translationsObj = JSON.parse(content);
      } catch (parseError) {
        logError('[OpenAI] JSON 파싱 실패. 응답 내용:', content);
        throw new Error(`OpenAI 응답이 JSON 형식이 아닙니다. 응답: ${content.substring(0, 100)}...`);
      }

      // PredictedTranslation 배열로 변환
      const translations: PredictedTranslation[] = [];
      for (const lang of SUPPORTED_LANGUAGES) {
        if (translationsObj[lang]) {
          translations.push({
            language: lang,
            value: translationsObj[lang]
          });
        }
      }

      // 글자수 내림차순 정렬 (searchService의 searchTranslations와 동일)
      translations.sort((a, b) => b.value.length - a.value.length);
      
      return translations;
    } catch (error) {
      logError('OpenAI API 호출 실패:', error);
      throw error;
    }
  }

  async getAbbreviatedTranslations(
    originalEnglish: string,
    formalTranslations: PredictedTranslation[],
    languagesToAbbreviate: string[]
  ): Promise<PredictedTranslation[]> {
    const apiKey = this.getApiKey();

    try {
      // 축약이 필요한 언어들의 정식 번역만 추출
      const translationsToAbbreviate = formalTranslations.filter(t =>
        languagesToAbbreviate.includes(t.language)
      );

      // 축약할 번역들을 JSON 형태로 변환
      const translationsJson: { [key: string]: string } = {};
      translationsToAbbreviate.forEach(t => {
        translationsJson[t.language] = t.value;
      });

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.getModel(),
          messages: [
            {
              role: 'system',
              content: `You are a professional game UI localization expert specializing in EXTREMELY space-constrained UI text (buttons, labels, tooltips). Your PRIMARY goal is to create the SHORTEST possible translation while maintaining core meaning.

                CRITICAL RULES - APPLY AGGRESSIVELY:
                1. ALWAYS abbreviate when possible - this is the default, not the exception
                2. Remove ALL articles (a, an, the, 그, 그것, la, le, etc.) unless grammatically essential
                3. Remove ALL auxiliary/helping verbs when meaning is clear without them
                4. Use standard abbreviations aggressively (Max, Min, Info, Num, Qty, Lvl, HP, MP, etc.)
                5. Remove redundant words - keep only the core noun/verb
                6. Prefer single words over phrases whenever possible
                7. Use symbols over words: % instead of "percent", + instead of "plus", etc.
                8. Remove polite/formal suffixes if casual form is acceptable in gaming context
                9. For compound concepts, use only the most essential word
                10. Only keep translation unchanged if it's ALREADY abbreviated (≤8 characters AND cannot be shortened further)

                ABBREVIATION INTENSITY BY LENGTH:
                - >25 characters: Reduce by at least 40%
                - 16-25 characters: Reduce by at least 30%
                - 10-15 characters: Reduce by at least 20%
                - <10 characters: Still try to shorten if possible

                EXAMPLES (notice the aggressive shortening):
                - "Maximum Health Points" → "Max HP" (65% reduction)
                - "Continue to Next Level" → "Continue" or "Next" (54-70% reduction)
                - "Player Statistics" → "Stats" (67% reduction)
                - "Inventory Management" → "Inventory" or "Items" (47-70% reduction)
                - "View Detailed Information" → "Details" or "Info" (67-79% reduction)
                - "Confirm Selection" → "Confirm" (47% reduction)
                - "戻る" (Japanese, 2 chars) → "戻る" (already minimal)
                - "設定を開く" → "設定" (remove verb when context is clear)
                - "Retour au menu" (French) → "Retour" or "Menu" (remove articles/prepositions)

                GAME UI CONTEXT: Buttons/labels must fit in small spaces. Brevity is MORE important than formality. When in doubt, ALWAYS choose the shorter option.`
            },
            {
              role: 'user',
              content: `Original English: "${originalEnglish}"
                Formal translations to abbreviate:
                ${JSON.stringify(translationsJson, null, 2)}
                TASK: Create AGGRESSIVELY shortened versions that are SIGNIFICANTLY shorter than originals. Apply all abbreviation rules intensively. The goal is MAXIMUM brevity while maintaining core meaning. Do NOT keep translations unchanged unless they are already at minimum length (≤8 characters AND cannot be shortened).
                Respond with ONLY a JSON object where keys are language codes and values are abbreviated translations.`
            }
          ],
          reasoning_effort: this.getReasoningEffort(),
          max_completion_tokens: 1000,
          response_format: { type: "json_object" },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`OpenAI API 오류: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content;

      if (!content) {
        throw new Error('OpenAI로부터 응답을 받지 못했습니다.');
      }

      logInfo('[OpenAI] Abbreviated response:', content.substring(0, 200));

      // JSON 파싱
      let abbreviatedObj: any;
      try {
        abbreviatedObj = JSON.parse(content);
      } catch (parseError) {
        logError('[OpenAI] JSON 파싱 실패. 응답 내용:', content);
        throw new Error(`OpenAI 응답이 JSON 형식이 아닙니다.`);
      }

      // 정식 번역과 동일한 순서로 결과 구성
      const result: PredictedTranslation[] = formalTranslations.map(formal => {
        if (languagesToAbbreviate.includes(formal.language) && abbreviatedObj[formal.language]) {
          return {
            language: formal.language,
            value: abbreviatedObj[formal.language]
          };
        }
        // 축약 대상이 아닌 언어는 정식 번역 그대로 반환
        return formal;
      });

      return result;
    } catch (error) {
      logError('축약 번역 API 호출 실패:', error);
      throw error;
    }
  }

  async getSynonyms(searchQuery: string, targetLanguage: string): Promise<string[]> {
    const apiKey = this.getApiKey();

    try {
      // 언어 코드를 언어명으로 변환
      const languageNames: { [key: string]: string } = {
        'ko': 'Korean',
        'ja': 'Japanese',
        'zh': 'Chinese',
        'zh-CN': 'Simplified Chinese',
        'zh-TW': 'Traditional Chinese',
        'en': 'English',
        'de': 'German',
        'es': 'Spanish',
        'es-MX': 'Mexican Spanish',
        'fr': 'French',
        'it': 'Italian',
        'pt': 'Portuguese',
        'pt-BR': 'Brazilian Portuguese',
        'ru': 'Russian',
        'ar': 'Arabic',
        'hi': 'Hindi',
        'th': 'Thai',
        'vi': 'Vietnamese',
        'id': 'Indonesian',
        'tr': 'Turkish',
        'pl': 'Polish',
        'uk': 'Ukrainian',
        'ur': 'Urdu',
        'ca': 'Catalan',
        'ku': 'Kurdish',
        'ga-IE': 'Irish',
      };

      const languageName = languageNames[targetLanguage] || 'English';

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.getModel(),
          messages: [
            {
              role: 'system',
              content: `You are a linguistic expert specializing in finding semantically similar words and phrases for game UI text search.

              Your task: Extract 1-3 KEY WORDS from the input query, then provide semantically similar words/phrases for each key word in the specified language.

              RULES:
              1. If input is a single word or short phrase (≤2 words): Provide synonyms directly
              2. If input is a longer phrase/sentence (>2 words): First extract 1-3 key words, then provide synonyms for each
              3. Return MAXIMUM 5 MOST semantically similar words/phrases per key word
              4. Similar words should be contextually relevant for game UI (buttons, labels, menus)
              5. PRIORITIZE semantic similarity over literal synonyms - focus on meaning, not just dictionary synonyms
              6. Focus on words that would ACTUALLY appear in similar game UI contexts (not theoretical synonyms)
              7. Exclude loosely related, tangentially connected, or overly broad terms
              8. Prefer commonly used terms over rare or literary alternatives
              9. Respond in the TARGET LANGUAGE specified by the user

              RESPONSE FORMAT (JSON only):
              {
                "keywords": ["keyword1", "keyword2"],
                "synonyms": ["synonym1", "synonym2", "synonym3", ...]
              }

              EXAMPLES:
              Input: "player" (English)
              Output: {"keywords": ["player"], "synonyms": ["user", "character", "gamer", "hero", "avatar"]}

              Input: "show player statistics" (English)
              Output: {"keywords": ["player", "statistics"], "synonyms": ["user", "character", "gamer", "stats", "info", "data", "details"]}

              Input: "플레이어" (Korean)
              Output: {"keywords": ["플레이어"], "synonyms": ["사용자", "유저", "캐릭터", "게이머"]}`
            },
            {
              role: 'user',
              content: `Search query: "${searchQuery}"
                Target language: ${languageName} (${targetLanguage})

                Extract key words (if needed) and provide semantically similar words/phrases in ${languageName}.
                Respond with JSON only.`
            }
          ],
          reasoning_effort: this.getReasoningEffort(),
          max_completion_tokens: 300,
          response_format: { type: "json_object" },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`OpenAI API 오류: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content;

      if (!content) {
        throw new Error('OpenAI로부터 응답을 받지 못했습니다.');
      }

      logInfo('[OpenAI] Synonyms response:', content);

      // JSON 파싱
      let result: any;
      try {
        result = JSON.parse(content);
      } catch (parseError) {
        logError('[OpenAI] JSON 파싱 실패. 응답 내용:', content);
        throw new Error(`OpenAI 응답이 JSON 형식이 아닙니다.`);
      }

      // synonyms 배열 반환
      if (result.synonyms && Array.isArray(result.synonyms)) {
        return result.synonyms;
      }

      return [];
    } catch (error) {
      logError('유의어 검색 API 호출 실패:', error);
      throw error;
    }
  }

  // 실행 중 모델을 명시적으로 재설정합니다.
  setModel(modelId: string) {
    this.modelOverride = modelId;
  }
}

export const openaiService = new OpenAIService();
