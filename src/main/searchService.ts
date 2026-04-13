import { fileService } from './fileService';
import { openaiService } from './openaiService';
import { logError } from './logUtil';

interface SearchResult {
  id: string;
  value: string;
  filename: string;
  length: number;
  distance?: number;
  matchType?: 'direct' | 'synonym'; // 직접 매칭 vs 유의어 매칭
  synonymSource?: string; // 유의어인 경우 원본 영어 단어
  isInputFolder?: boolean; // input 폴더 결과 여부
  priority?: number; // 검색 우선순위 (낮을수록 우선)
}

interface SynonymSearchResult {
  results: SearchResult[];
  synonymsList: string[]; // WordNet에서 찾은 모든 유의어 목록
}

class SearchService {
  // 레벤슈타인 거리 계산 (두 문자열의 차이)
  private levenshteinDistance(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;
    const matrix: number[][] = [];

    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }

    return matrix[len1][len2];
  }

  search(query: string, language: string): SearchResult[] {
    const lowerQuery = query.toLowerCase();

    // 병렬 처리: ui_XX.json과 input 폴더 동시 검색
    const uiResults = this.searchUIFile(query, language, lowerQuery);
    const inputResults = this.searchInputFolder(query, lowerQuery);

    // 중복 제거: ui_XX.json에 해당 String ID가 존재하면 input 폴더 결과 제외
    // 쿼리 매칭 여부가 아닌, UI 파일 내 ID 존재 여부로 판단해야 정확한 Unreleased 판정 가능
    const uiFileData = fileService.getFileData(language);
    const allUiIds = uiFileData ? new Set(Object.keys(uiFileData)) : new Set<string>();
    const filteredInputResults = inputResults.filter(r => !allUiIds.has(r.id));

    // 결과 병합 및 정렬
    const allResults = [...uiResults, ...filteredInputResults];

    // 1차: 우선순위 정렬 (낮을수록 우선)
    // 2차: 레벤슈타인 거리 정렬 (작을수록 유사)
    allResults.sort((a, b) => {
      if ((a.priority || 999) !== (b.priority || 999)) {
        return (a.priority || 999) - (b.priority || 999);
      }
      return (a.distance || 0) - (b.distance || 0);
    });

    return allResults;
  }

  private searchUIFile(query: string, language: string, lowerQuery: string): SearchResult[] {
    const fileData = fileService.getFileData(language);
    if (!fileData) {
      return [];
    }

    const results: SearchResult[] = [];

    for (const [id, value] of Object.entries(fileData)) {
      const lowerValue = value.toLowerCase();
      const lowerId = id.toLowerCase();

      let priority: number | undefined;

      // 우선순위 1: String ID 완전 일치
      if (lowerId === lowerQuery) {
        priority = 1;
      }
      // 우선순위 2: Value 부분 일치
      else if (lowerValue.includes(lowerQuery)) {
        priority = 2;
      }
      // 우선순위 3: String ID 부분 일치
      else if (lowerId.includes(lowerQuery)) {
        priority = 3;
      }

      if (priority !== undefined) {
        const distance = this.levenshteinDistance(lowerQuery, lowerValue);
        results.push({
          id,
          value,
          filename: `ui_${language}.json`,
          length: value.length,
          distance,
          priority,
        });
      }
    }

    return results;
  }

  private searchInputFolder(query: string, lowerQuery: string): SearchResult[] {
    const inputFiles = fileService.getInputFiles();
    const results: SearchResult[] = [];

    for (const [filename, data] of inputFiles.entries()) {
      for (const [stringId, obj] of Object.entries(data)) {
        const lowerId = stringId.toLowerCase();
        const lowerText = obj.Text.toLowerCase();

        let priority: number | undefined;

        // 우선순위 1: String ID 완전 일치
        if (lowerId === lowerQuery) {
          priority = 1;
        }
        // 우선순위 2: Text 부분 일치
        else if (lowerText.includes(lowerQuery)) {
          priority = 2;
        }
        // 우선순위 3: String ID 부분 일치
        else if (lowerId.includes(lowerQuery)) {
          priority = 3;
        }

        if (priority !== undefined) {
          const distance = this.levenshteinDistance(lowerQuery, lowerText);
          results.push({
            id: stringId,
            value: obj.Text,
            filename: `input/${filename}`,
            length: obj.Text.length,
            distance,
            priority,
            isInputFolder: true,
          });
        }
      }
    }

    return results;
  }

  searchTranslations(stringId: string): SearchResult[] {
    const allFiles = fileService.getAllFiles();
    const results: SearchResult[] = [];

    for (const [lang, data] of allFiles.entries()) {
      if (data[stringId]) {
        results.push({
          id: stringId,
          value: data[stringId],
          filename: lang,
          length: data[stringId].length,
        });
      }
    }

    // 글자수 내림차순 정렬
    results.sort((a, b) => b.length - a.length);

    return results;
  }

  // 목표 언어 JSON에서 특정 단어를 포함하는 STRING_ID 찾기
  private searchInLanguageData(searchWord: string, language: string): string[] {
    const languageData = fileService.getFileData(language);
    if (!languageData) {
      return [];
    }

    const lowerSearchWord = searchWord.toLowerCase();
    const matchedIds: string[] = [];

    for (const [id, value] of Object.entries(languageData)) {
      const lowerValue = value.toLowerCase();

      // 단어 경계를 고려한 매칭 (부분 문자열이 아닌 단어 단위)
      const words = lowerValue.split(/\s+/);
      if (words.includes(lowerSearchWord) || lowerValue.includes(lowerSearchWord)) {
        matchedIds.push(id);
      }
    }

    return matchedIds;
  }

  // OpenAI 기반 유의어 검색
  async searchSynonyms(searchQuery: string, targetLanguage: string): Promise<SynonymSearchResult> {
    try {
      // 1. OpenAI로 유의어 추출 (검색어를 그대로 사용)
      const synonyms = await openaiService.getSynonyms(searchQuery, targetLanguage);

      if (synonyms.length === 0) {
        return { results: [], synonymsList: [] };
      }

      // 2. 유의어로 목표 언어 JSON에서 STRING_ID 찾기
      const relatedStringIds = new Set<string>();
      for (const synonym of synonyms) {
        const ids = this.searchInLanguageData(synonym, targetLanguage);
        ids.forEach(id => {
          relatedStringIds.add(id);
        });
      }

      // 3. 찾은 STRING_ID들을 결과로 변환
      const targetData = fileService.getFileData(targetLanguage);
      if (!targetData) {
        return { results: [], synonymsList: synonyms };
      }

      const results: SearchResult[] = [];
      for (const id of relatedStringIds) {
        if (targetData[id]) {
          results.push({
            id,
            value: targetData[id],
            filename: `ui_${targetLanguage}.json`,
            length: targetData[id].length,
            matchType: 'synonym',
          });
        }
      }

      // 4. 레벤슈타인 거리로 정렬 (원본 검색어와 가까운 순)
      results.forEach(result => {
        result.distance = this.levenshteinDistance(searchQuery.toLowerCase(), result.value.toLowerCase());
      });

      results.sort((a, b) => (a.distance || 0) - (b.distance || 0));

      // 최대 50개로 제한하고 유의어 목록과 함께 반환
      return {
        results: results.slice(0, 50),
        synonymsList: synonyms,
      };
    } catch (error) {
      logError('유의어 검색 오류:', error);
      return { results: [], synonymsList: [] };
    }
  }
}

export const searchService = new SearchService();
