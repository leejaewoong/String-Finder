# L10N Feature Selection and Type Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 작업자가 지정한 FEATURE PREFIX를 모든 String ID 후보에 사용하고, ORDO 구조 기반 Type 판별·COMMON/DEV 재사용·즉시 Release Date 제안을 구현한다.

**Architecture:** JSON 키를 읽는 순수 feature catalog가 UI 선택지와 backend 대상 파일 매핑의 단일 근거가 된다. LLM은 SCREEN과 fallback Type만 제안하며 결정적 Figma 경로 규칙이 Type을 최종 보정한다. String ID 규칙 엔진은 선택 피쳐와 catalog 매핑을 받아 COMMON/DEV 재사용과 COMMON 승격을 결정한다.

**Tech Stack:** Electron 27, React 18, TypeScript 5, Vitest, Tailwind CSS, OpenAI Chat Completions API

**Spec:** `docs/superpowers/specs/2026-09-01-l10n-feature-and-type-rules-design.md`

## Global Constraints

- `DUALMATCHMAKING`을 포함한 확정 제외 목록은 피쳐 선택지에서만 숨긴다.
- 기존 키 재사용은 `ui_common.json` 우선, `ui_dev.json` fallback이다.
- FEATURE는 사용자 입력, SCREEN은 LLM, Type은 구조 규칙 우선이다.
- 신규 JSON 파일을 자동 생성하지 않는다.
- 기존 C안의 레이아웃과 상태 UI를 유지한다.
- Git commit과 push는 수행하지 않는다.

---

### Task 1: JSON 키 기반 Feature Catalog

**Files:**
- Create: `src/main/l10n/featureCatalog.ts`
- Create: `src/main/l10n/__tests__/featureCatalog.test.ts`
- Modify: `src/shared/l10nTypes.ts`
- Modify: `src/main/l10n/registerL10nIpc.ts`
- Modify: `src/preload/preload.ts`
- Modify: `src/renderer/types/index.ts`

**Interfaces:**
- Produces: `L10nFeatureOption { prefix: string; targetFile: string }`
- Produces: `buildFeatureCatalog(files: Map<string, InputFileData>): L10nFeatureOption[]`
- Produces: `featureTargetMap(options): Map<string, string>`
- Produces: IPC `l10n:get-feature-options`

- [ ] **Step 1: 실패하는 catalog 테스트를 작성한다**

```ts
const options = buildFeatureCatalog(new Map([
  ['ui_dev.json', { 'TOS:MAIN_BODY_0': entry, 'DUALMATCHMAKING:MAIN_BODY_0': entry }],
  ['ui_lobby.json', { 'REPUTATION:MAIN_BODY_0': entry }],
]));
expect(options).toEqual([
  { prefix: 'REPUTATION', targetFile: 'ui_lobby.json' },
  { prefix: 'TOS', targetFile: 'ui_dev.json' },
]);
```

Run: `npm test -- featureCatalog.test.ts`
Expected: 모듈이 없어 FAIL.

- [ ] **Step 2: catalog와 중복 기본 매핑을 최소 구현한다**

각 JSON key를 `parseStringId`로 읽고 제외 목록과 `COMMON`을 거른다. 동일 prefix가 여러 파일에 있으면 확정된 기본 매핑을 사용하고 결과는 prefix 오름차순으로 반환한다.

- [ ] **Step 3: IPC와 renderer 타입을 연결한다**

`getL10nFeatureOptions(): Promise<L10nFeatureOption[]>`가 현재 UI input 폴더를 읽어 catalog를 반환하게 한다.

- [ ] **Step 4: catalog 테스트를 통과시킨다**

Run: `npm test -- featureCatalog.test.ts`
Expected: PASS.

### Task 2: FEATURE 입력과 draft 보존

**Files:**
- Modify: `src/shared/l10nTypes.ts`
- Modify: `src/main/l10n/l10nDraft.ts`
- Modify: `src/main/l10n/__tests__/l10nDraft.test.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/StringIdGenerator.tsx`
- Modify: `src/renderer/styles/globals.css`

**Interfaces:**
- Extends: `L10nInput.featurePrefix: string`
- Extends: `L10nDraft.featurePrefix: string`

- [ ] **Step 1: featurePrefix 저장을 요구하는 실패 테스트를 작성한다**

```ts
expect(normalizeL10nDraft({ featurePrefix: ' clan ' })).toMatchObject({ featurePrefix: 'CLAN' });
```

Run: `npm test -- l10nDraft.test.ts`
Expected: `featurePrefix`가 없어 FAIL.

- [ ] **Step 2: draft/input 타입과 정규화를 구현한다**

빈 draft는 `featurePrefix: ''`를 갖고 저장값은 대문자 영숫자와 `_`만 유지한다.

- [ ] **Step 3: C안 입력 패널에 editable feature combobox를 추가한다**

`FEATURE PREFIX` input과 `datalist`를 FIGMA와 RELEASE DATE 사이에 배치한다. options는 IPC에서 가져오며 목록 밖 값도 입력할 수 있다. 실행 가능 조건에 유효한 featurePrefix를 추가한다.

- [ ] **Step 4: draft 테스트와 타입 검사를 통과시킨다**

Run: `npm test -- l10nDraft.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

### Task 3: 선택 FEATURE와 COMMON/DEV 규칙

**Files:**
- Modify: `src/main/l10n/stringIdRules.ts`
- Modify: `src/main/l10n/__tests__/stringIdRules.test.ts`
- Modify: `src/main/l10n/l10nOrchestrator.ts`
- Modify: `src/main/l10n/__tests__/l10nOrchestrator.test.ts`

**Interfaces:**
- Extends: `decideStringIds(..., targetFiles?: ReadonlyMap<string, string>)`
- Changes: `OpenAiGateway.infer(rows, [input.featurePrefix], signal)`

- [ ] **Step 1: 자동 재사용 범위와 target mapping의 실패 테스트를 작성한다**

```ts
expect(commonDecision.stringId).toBe('COMMON:MAIN_BUTTON_0');
expect(devDecision.stringId).toBe('TOS:MAIN_BUTTON_0');
expect(featureSpecificMatch.action).toBe('create');
expect(mappedDecision.targetFile).toBe('ui_lobby.json');
```

두 다른 일반 피쳐가 일치할 때만 COMMON을 생성하고 `ui_dev.json`, `ui_common.json`, 선택 target 파일은 그 개수에서 제외하는 테스트를 포함한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test -- stringIdRules.test.ts`
Expected: 기존 same-feature 재사용과 DEV의 COMMON count 때문에 FAIL.

- [ ] **Step 3: 결정 규칙을 최소 구현한다**

COMMON 후보와 DEV 후보를 각각 최신 날짜/ID 순으로 선택한다. 일반 피쳐 일치는 재사용하지 않고 두 다른 target 파일 존재 여부에만 사용한다. 모든 target file 계산은 catalog map을 우선한다.

- [ ] **Step 4: orchestrator가 사용자 FEATURE만 LLM에 전달하는 실패 테스트를 작성한다**

```ts
expect(deps.openAi.infer).toHaveBeenCalledWith(
  expect.any(Array),
  ['EOM'],
  expect.any(AbortSignal),
);
```

- [ ] **Step 5: generate/finalize/table-create 세 경로에 catalog map을 연결한다**

각 경로는 loaded files에서 catalog를 만든 뒤 `[input.featurePrefix]`를 LLM에 넘기고 같은 map을 `decideStringIds`에 넘긴다. `validateInput`은 featurePrefix 형식을 검사한다.

- [ ] **Step 6: 관련 테스트를 통과시킨다**

Run: `npm test -- stringIdRules.test.ts l10nOrchestrator.test.ts`
Expected: PASS.

### Task 4: ORDO 구조 기반 Type 보정

**Files:**
- Modify: `src/main/l10n/stringIdRules.ts`
- Modify: `src/main/l10n/l10nOpenAiClient.ts`
- Modify: `src/main/l10n/__tests__/l10nOpenAiClient.test.ts`

**Interfaces:**
- Adds: `LNB` to `STRING_ID_TYPES`
- Produces: `inferTypeFromFigmaContext(row): StringIdType | undefined`

- [ ] **Step 1: 구조 판별 실패 테스트를 작성한다**

```ts
expect(inferTypeFromFigmaContext({ layerPath: ['Side Tab', 'Label'] })).toBe('BUTTON');
expect(inferTypeFromFigmaContext({ layerPath: ['Contents Switch', 'Button', 'Text'] })).toBe('BUTTON');
expect(inferTypeFromFigmaContext({ layerPath: ['Title', 'LNB', 'Button', 'Text'] })).toBe('LNB');
expect(inferTypeFromFigmaContext({ layerPath: ['Panel', 'LNB', 'Text'] })).toBeUndefined();
```

Run: `npm test -- l10nOpenAiClient.test.ts`
Expected: 함수와 LNB가 없어 FAIL.

- [ ] **Step 2: 구조 규칙과 LLM fallback을 구현한다**

구조 규칙이 있으면 모델의 Type을 덮어쓰고, 없으면 검증된 모델 Type을 유지한다. prompt는 FEATURE가 사용자 고정값이며 기존 ID보다 ORDO 경로가 우선임을 명시한다.

- [ ] **Step 3: OpenAI 테스트를 통과시킨다**

Run: `npm test -- l10nOpenAiClient.test.ts`
Expected: PASS.

### Task 5: Release Date 즉시 제안과 캘린더 표시

**Files:**
- Modify: `src/renderer/l10nPresentation.ts`
- Modify: `src/main/l10n/__tests__/l10nPresentation.test.ts`
- Modify: `src/renderer/components/StringIdGenerator.tsx`
- Modify: `src/renderer/styles/globals.css`

**Interfaces:**
- Produces: `shouldSuggestReleaseDate(draft, figmaUrls, configured): boolean`

- [ ] **Step 1: 자동 제안 조건의 실패 테스트를 작성한다**

```ts
expect(shouldSuggestReleaseDate({ releaseDate: '', releaseDateSource: 'manual', wikiUrl: validUrl }, [], true)).toBe(true);
expect(shouldSuggestReleaseDate({ releaseDate: '2026-12-03', releaseDateSource: 'manual', wikiUrl: validUrl }, [], true)).toBe(false);
```

Run: `npm test -- l10nPresentation.test.ts`
Expected: helper가 없어 FAIL.

- [ ] **Step 2: 400ms timeout 없이 즉시 조회하도록 effect를 수정한다**

effect가 실행되면 바로 IPC를 호출하고 cleanup flag로 이전 응답을 무시한다. 완성된 Confluence/Figma URL이 하나 이상 있을 때만 호출한다.

- [ ] **Step 3: 캘린더 아이콘 스타일을 추가한다**

`::-webkit-calendar-picker-indicator`에 흰색 필터와 적절한 opacity를 적용한다.

- [ ] **Step 4: 관련 테스트와 타입 검사를 통과시킨다**

Run: `npm test -- l10nPresentation.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

### Task 6: 전체 회귀 검증

**Files:**
- Verify only

**Interfaces:**
- Consumes: Tasks 1-5의 모든 변경
- Produces: 검증 결과

- [ ] **Step 1: 전체 테스트를 실행한다**

Run: `npm test`
Expected: 모든 테스트 PASS.

- [ ] **Step 2: 타입 검사를 실행한다**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: production build를 실행한다**

Run: `npm run build`
Expected: webpack main/preload/renderer 빌드 PASS.

- [ ] **Step 4: diff를 요구사항과 대조한다**

Run: `git diff --check`
Expected: 공백 오류 없음.

Run: `git status --short`
Expected: 이번 요구사항과 기존 PoC 변경만 표시되고 토큰·빌드 산출물은 없음.
