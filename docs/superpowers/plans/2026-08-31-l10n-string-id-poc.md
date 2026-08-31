# L10N String ID PoC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Figma 스트링 태그와 Confluence 표를 바탕으로 String ID를 생성하고 검토 후 로컬 GDD JSON에 반영하는 Windows PoC를 String-Finder에 추가한다.

**Architecture:** Electron renderer는 C안 전용 화면과 상태 표시를 담당하고, preload IPC 뒤의 main process가 환경설정·Figma·Confluence·LLM·JSON을 처리한다. 외부 클라이언트와 순수 규칙 모듈을 분리해 규칙은 fixture 기반 단위 테스트로, 실제 API 연결은 패키징 앱 수동 테스트로 검증한다.

**Tech Stack:** Electron 27, React 18, TypeScript 5, Webpack 5, Tailwind CSS 3, Vitest, Cheerio 1.0, Figma REST API, Confluence REST API v1/v2, OpenAI Chat Completions API

**Spec:** `docs/superpowers/specs/2026-08-31-l10n-string-id-poc-design.md`

## Global Constraints

- 실제 `.env`와 토큰은 Git·설치 파일·로그에 포함하지 않는다.
- 설치 앱 설정 파일은 `%APPDATA%\String-Finder\.env`, 개발 설정 파일은 프로젝트 루트 `.env`다.
- Figma 대상은 `%stringTag` payload이며 `[L10N_NEW]` 접두어를 사용하지 않는다.
- 기존 위키 표에는 `String ID` 외의 컬럼·행 구조를 자동 변경하지 않는다.
- 항목별 불일치는 건너뛰고 정상 항목을 계속 처리한다.
- Git pull, commit, push와 사내 Gateway는 제품 기능 범위에서 제외한다.
- `ui_dev.json`은 COMMON 피처 수 계산에 포함하고 `ui_common.json`만 제외한다.

---

### Task 1: 테스트 기반과 환경설정

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.json`
- Modify: `electron-builder.json`
- Create: `.env.example`
- Create: `src/shared/l10nTypes.ts`
- Create: `src/main/l10n/envService.ts`
- Test: `src/main/l10n/__tests__/envService.test.ts`

**Interfaces:**
- Produces: `L10nConfigStatus`, `L10nTaskState`, `L10nInput`, `L10nIssue`, `L10nRunResult` shared types
- Produces: `resolveEnvPath(isPackaged, appDataPath, projectRoot): string`
- Produces: `reloadEnvironment(envPath): void`, `getL10nConfigStatus(envPath): L10nConfigStatus`, `ensureEnvFile(envPath): Promise<string>`

- [x] **Step 1: 테스트 러너와 의존성을 추가한다**

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": { "cheerio": "^1.0.0" },
  "devDependencies": { "vitest": "^3.2.4" }
}
```

Run: `npm install`
Expected: `package-lock.json`이 갱신되고 설치가 성공한다.

- [x] **Step 2: 실패하는 환경 경로 테스트를 작성한다**

```ts
expect(resolveEnvPath(false, 'C:/AppData', 'C:/repo')).toBe('C:\\repo\\.env');
expect(resolveEnvPath(true, 'C:/Users/me/AppData/Roaming', 'C:/repo'))
  .toBe('C:\\Users\\me\\AppData\\Roaming\\String-Finder\\.env');
```

Run: `npm test -- envService.test.ts`
Expected: `resolveEnvPath`가 없어 FAIL.

- [x] **Step 3: 환경설정 모듈과 공유 타입을 구현한다**

`reloadEnvironment`는 `dotenv.config({ path: envPath, override: true })`를 사용한다. 필수 키는 `FIGMA_API_TOKEN`, `CONFLUENCE_BASE_URL`, `CONFLUENCE_EMAIL`, `CONFLUENCE_API_TOKEN`, `OPENAI_API_KEY`다. `ensureEnvFile`은 폴더를 만들고 파일이 없을 때만 빈 템플릿을 작성한다.

- [x] **Step 4: 실제 `.env` 패키징을 제거한다**

`electron-builder.json`의 `.env` extraResource를 제거하고 `.env.example`에는 키 이름과 빈 값만 둔다.

- [x] **Step 5: 테스트·타입 검사를 실행한다**

Run: `npm test -- envService.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

- [x] **Step 6: 커밋한다**

```text
🔨Env(Many): L10N PoC 환경설정과 테스트 기반 추가
```

### Task 2: Figma 스트링 태그와 프레임 추출

**Files:**
- Create: `src/main/l10n/figmaTag.ts`
- Create: `src/main/l10n/figmaClient.ts`
- Test: `src/main/l10n/__tests__/figmaTag.test.ts`
- Test: `src/main/l10n/__tests__/fixtures/figmaNodes.ts`

**Interfaces:**
- Consumes: `L10nIssue` from `src/shared/l10nTypes.ts`
- Produces: `parseFigmaUrl(url): { fileKey: string; nodeId?: string }`
- Produces: `parseStringTagName(name): ParsedStringTag | null`
- Produces: `scanStringTags(root): FigmaTaggedString[]`
- Produces: `selectExportFrame(tagNodeId, targetNodeId, index): FigmaNode | null`
- Produces: `FigmaClient.scan(urls, signal): Promise<FigmaScanResult>` and `FigmaClient.exportFrame(fileKey, frameId, outputPath, signal): Promise<void>`

- [x] **Step 1: 실패하는 parser 테스트를 작성한다**

```ts
const parsed = parseStringTagName(
  '03. 스트링 태그 (%stringTag^A^GEAR HEAD^I1889:25171;8970:7176^피쳐:화면_타입_숫자)'
);
expect(parsed).toMatchObject({ delimiter: 'A', locator: 'I1889:25171;8970:7176' });
expect(parseStringTagName('일반 텍스트')).toBeNull();
```

Run: `npm test -- figmaTag.test.ts`
Expected: parser가 없어 FAIL.

- [x] **Step 2: URL·payload parser를 구현한다**

Figma URL의 `/design/<fileKey>/`를 읽고 `node-id=1896-82522`를 `1896:82522`로 변환한다. payload는 정확히 5개 필드로 검증하며 locator의 세미콜론은 유지한다.

- [x] **Step 3: 실패하는 프레임 선택 테스트를 작성한다**

fixture는 `스펙 페이지` 아래에 태그와 `메인_외형 챌린지 선택` FRAME을 형제로 두고, FRAME 안에 타겟 TEXT를 둔다.

```ts
expect(selectExportFrame('tag:A', 'target:A', buildNodeIndex(fixture))?.name)
  .toBe('메인_외형 챌린지 선택');
```

Run: `npm test -- figmaTag.test.ts`
Expected: 프레임 선택이 없어 FAIL.

- [x] **Step 4: 노드 인덱스·타겟 텍스트·프레임 선택을 구현한다**

타겟은 포함하지만 태그는 포함하지 않는 가장 바깥 FRAME을 선택한다. 같은 프레임의 태그는 그룹화하고 구분자를 자연 정렬한다. 직접 TEXT는 `characters`, 인스턴스는 locator로 받은 서브트리의 유효 TEXT 또는 `Text` component property를 사용한다.

- [x] **Step 5: Figma REST client를 구현한다**

`GET /v1/files/:key/nodes?ids=...`와 `GET /v1/images/:key?ids=...&format=png&scale=1`을 사용한다. 모든 요청에 `X-Figma-Token`을 넣고 `AbortSignal`을 전달한다. 렌더 URL 응답은 임시 PNG 파일로 저장한다.

- [x] **Step 6: 테스트와 타입 검사를 실행한다**

Run: `npm test -- figmaTag.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

- [x] **Step 7: 커밋한다**

```text
✨Feat(l10n/figmaTag.ts, l10n/figmaClient.ts, __tests__/figmaTag.test.ts): Figma 스트링 태그 분석 추가
```

### Task 3: Confluence 표와 ReleaseDate

**Files:**
- Create: `src/main/l10n/confluenceTable.ts`
- Create: `src/main/l10n/confluenceClient.ts`
- Create: `src/main/l10n/releaseDate.ts`
- Test: `src/main/l10n/__tests__/confluenceTable.test.ts`
- Test: `src/main/l10n/__tests__/releaseDate.test.ts`

**Interfaces:**
- Consumes: `FigmaScanResult`
- Produces: `findL10nTable(storage): L10nTable | null`
- Produces: `createL10nTable(storage, frameGroups): string`
- Produces: `applyStringIdColumn(storage, updates): string`
- Produces: `ConfluenceClient.getPage`, `updatePage`, `uploadAttachment`, `getUpdateChildren`
- Produces: `extractVersionCode(title): string | null`, `resolveReleaseDate(input): Promise<ReleaseDateSuggestion>`

- [x] **Step 1: 실패하는 표 감지·생성 테스트를 작성한다**

```ts
expect(findL10nTable('<table><tr><th>국문</th><th>영문</th></tr></table>')).not.toBeNull();
expect(findL10nTable('<table><tr><th>이름</th></tr></table>')).toBeNull();
expect(createL10nTable('<p>기존 본문</p>', groups)).toContain('ri:filename="frame.png"');
```

Run: `npm test -- confluenceTable.test.ts`
Expected: 함수가 없어 FAIL.

- [x] **Step 2: Cheerio 기반 표 parser와 writer를 구현한다**

헤더 별칭을 인식하고 기존 표에는 `String ID` 컬럼만 추가한다. 새 표는 `구분자 | 이미지 | 국문 | 영문 | String ID` 순서이며 이미지 셀에 `rowspan`과 `ac:image/ri:attachment`를 사용한다. 기존 본문 뒤에 추가한다.

- [x] **Step 3: 부분 비교 테스트를 추가하고 구현한다**

정상 행은 처리 목록, Figma 전용은 `WIKI_ROW_MISSING`, 위키 전용은 `FIGMA_TAG_MISSING`, 국문 차이는 `KOREAN_MISMATCH` issue로 분리한다. 오류 행이 있어도 정상 행 배열은 유지한다.

- [x] **Step 4: Confluence client를 구현한다**

Basic 인증을 사용해 v2 page storage를 읽고 version+1로 갱신한다. 첨부는 v1 attachment API에서 결정적 파일명을 조회해 신규 업로드 또는 새 버전 업로드한다. PUT 직전에 페이지 버전을 다시 읽어 충돌을 검사한다.

- [x] **Step 5: ReleaseDate 실패 테스트와 구현을 추가한다**

```ts
expect(extractVersionCode('[v2607-10] 메시지')).toBe('v2607');
expect(selectVersionSource('v2607', 'v2608').version).toBe('v2607');
expect(selectVersionSource(undefined, 'v2608').version).toBe('v2608');
```

업데이트 루트 `134241634`의 연도 하위 문서를 읽고 버전 행의 PC 날짜를 찾는다. 자동값과 출처, 위키·Figma 불일치 경고를 반환한다.

- [x] **Step 6: 테스트·타입 검사를 실행한다**

Run: `npm test -- confluenceTable.test.ts releaseDate.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

- [x] **Step 7: 커밋한다**

```text
✨Feat(Many): Confluence 표 생성과 ReleaseDate 추출 추가
```

### Task 4: String ID 규칙과 LLM 분류

**Files:**
- Create: `src/main/l10n/stringIdRules.ts`
- Create: `src/main/l10n/l10nOpenAiClient.ts`
- Test: `src/main/l10n/__tests__/stringIdRules.test.ts`

**Interfaces:**
- Produces: `buildStringIndex(files): StringIndex`
- Produces: `decideStringIds(rows, inference, index, releaseDate): StringIdDecision[]`
- Produces: `L10nOpenAiClient.infer(rows, context, signal): Promise<StringIdInference[]>`

- [x] **Step 1: 기존 키 재사용과 COMMON 실패 테스트를 작성한다**

```ts
expect(decide(oneRow, indexWithSameFeatureKey).action).toBe('reuse');
expect(decide(oneRow, indexWithCommonKey).stringId).toBe('COMMON:TAG_FLOAT_0');
expect(decide(crossFeatureRow, indexAcrossClanAndDev).stringId.startsWith('COMMON:')).toBe(true);
```

Run: `npm test -- stringIdRules.test.ts`
Expected: 규칙 엔진이 없어 FAIL.

- [x] **Step 2: JSON 인덱스와 정규화를 구현한다**

Text는 trim과 CRLF→LF만 정규화한다. 타입은 허용 타입과 ID suffix에서 추출한다. COMMON 선택은 최신 ReleaseDate, String ID 오름차순으로 결정한다.

- [x] **Step 3: 충돌·번호 테스트와 구현을 추가한다**

기존 ID와 다른 Text는 같은 `FEATURE:SCREEN_TYPE` prefix의 최대 번호+1을 사용한다. 위키 내부 중복은 뒤 행부터 재번호화한다. 유효한 사용자 ID는 COMMON 우선 또는 실제 충돌이 아니면 보존한다.

- [x] **Step 4: LLM client를 구현한다**

한 요청에 처리 가능한 행을 JSON array로 보내고 `rowKey`, `feature`, `screen`, `type`만 받는다. feature 후보는 실제 `ui_*.json` 파일명, type은 허용 목록으로 제한한다. 응답을 schema 수준으로 검증하고 잘못된 행만 issue로 반환한다.

- [x] **Step 5: 테스트·타입 검사를 실행한다**

Run: `npm test -- stringIdRules.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

- [x] **Step 6: 커밋한다**

```text
✨Feat(l10n/stringIdRules.ts, l10n/l10nOpenAiClient.ts, __tests__/stringIdRules.test.ts): String ID 결정 규칙 추가
```

### Task 5: JSON 변경과 롤백

**Files:**
- Create: `src/main/l10n/jsonRepository.ts`
- Test: `src/main/l10n/__tests__/jsonRepository.test.ts`

**Interfaces:**
- Produces: `loadInputFiles(uiRoot): Promise<Map<string, InputFileData>>`
- Produces: `planJsonChanges(decisions, files): JsonChangePlan`
- Produces: `applyJsonChanges(plan, backupRoot): Promise<JsonApplyResult>`

- [x] **Step 1: 재사용 무변경·신규 추가 테스트를 작성한다**

```ts
expect(planJsonChanges([reuseDecision], files).files).toHaveLength(0);
expect(planJsonChanges([newClanDecision], files).files[0].fileName).toBe('ui_clan.json');
```

Run: `npm test -- jsonRepository.test.ts`
Expected: 함수가 없어 FAIL.

- [x] **Step 2: 변경 계획과 결정적 JSON 직렬화를 구현한다**

기존 키 순서를 보존하고 신규 키를 String ID 오름차순으로 추가한다. 대상 파일이 없거나 ID 형식이 유효하지 않으면 해당 항목을 issue로 분리한다.

- [x] **Step 3: 롤백 테스트를 작성하고 구현한다**

모든 새 내용을 임시 파일로 쓰고 JSON 재파싱 후 원본을 백업한다. 교체 실패를 주입한 테스트에서 앞서 교체한 파일이 백업으로 복구되는지 확인한다.

- [x] **Step 4: 테스트·타입 검사를 실행한다**

Run: `npm test -- jsonRepository.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

- [x] **Step 5: 커밋한다**

```text
✨Feat(l10n/jsonRepository.ts, __tests__/jsonRepository.test.ts): JSON 변경과 롤백 추가
```

### Task 6: 작업 오케스트레이션과 IPC

**Files:**
- Create: `src/main/l10n/l10nOrchestrator.ts`
- Create: `src/main/l10n/registerL10nIpc.ts`
- Modify: `src/main/main.ts`
- Modify: `src/preload/preload.ts`
- Modify: `src/renderer/types/index.ts`
- Test: `src/main/l10n/__tests__/l10nOrchestrator.test.ts`

**Interfaces:**
- Consumes: Task 1~5의 clients와 규칙 모듈
- Produces: `L10nOrchestrator.suggestReleaseDate(input)`, `generate(input)`, `finalize(input)`, `cancel()`, `getState()`
- Produces IPC: `l10n:get-config`, `l10n:open-env`, `l10n:suggest-release-date`, `l10n:generate`, `l10n:finalize`, `l10n:cancel`, `l10n:get-state`
- Produces event: `l10n:state-changed`

- [x] **Step 1: 표 없음→영문 대기 상태 테스트를 작성한다**

mock client로 표가 없는 페이지를 반환하고 `generate` 후 상태가 `english-review`인지, 표 업데이트가 한 번인지 확인한다.

- [x] **Step 2: 기존 표→부분 처리→검토 대기 테스트를 작성한다**

정상 2행과 불일치 1행을 주고 정상 행 ID만 위키에 쓰며 상태 배지에 `attentionCount: 1`이 남는지 확인한다.

- [x] **Step 3: 반복 생성·취소·최종 확정 테스트를 작성한다**

반복 생성은 최신 위키 값을 다시 읽고, 취소는 AbortController를 호출하며, 최종 확정은 최신 위키 검증 후 JSON service를 한 번 호출해야 한다.

- [x] **Step 4: 오케스트레이터를 최소 구현해 테스트를 통과시킨다**

위키 쓰기 전 모든 표·ID 내용을 메모리에서 완성한다. 항목 issue와 단계 중단 error를 구분한다. 상태 변경 때 구독자에게 immutable snapshot을 보낸다.

- [x] **Step 5: IPC와 preload 타입을 연결한다**

preload 이벤트 등록 함수는 cleanup 함수를 반환해 React unmount 시 listener를 제거한다. main은 BrowserWindow에 상태 snapshot만 전송한다.

- [x] **Step 6: 테스트·타입 검사를 실행한다**

Run: `npm test -- l10nOrchestrator.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

- [x] **Step 7: 커밋한다**

```text
✨Feat(Many): L10N 작업 흐름과 IPC 연결 추가
```

### Task 7: C안 전용 화면

**Files:**
- Create: `src/renderer/components/AppTabs.tsx`
- Create: `src/renderer/components/StringIdGenerator.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/Header.tsx`
- Modify: `src/renderer/styles/globals.css`

**Interfaces:**
- Consumes: `window.electron` L10N IPC와 `L10nTaskState`
- Produces: `AppView = 'search' | 'string-id'`

- [x] **Step 1: 헤더와 탭 구조를 구현한다**

Header의 하단 border를 제거한다. 그 아래 `문자열 검색`, `String ID 생성` 탭을 추가하고 String ID 탭에 상태·확인 필요 수 badge를 표시한다.

- [x] **Step 2: 입력과 ReleaseDate 자동 제안을 구현한다**

위키 URL, 줄 단위 Figma URL들, ReleaseDate를 표시한다. 400ms debounce 후 날짜 제안을 요청한다. 사용자가 날짜를 수정한 이후에는 `releaseDateSource: 'manual'`로 두어 자동값으로 덮어쓰지 않는다.

- [x] **Step 3: 작업 버튼과 상태 패널을 구현한다**

상단에 `작업 취소`, `String ID 생성`, `최종 확정`을 배치한다. RELEASE DATE 아래에는 취소·재생성 안내를 두지 않는다. 우측 패널은 단계, 통계, 마지막 생성 시각, 펼침 가능한 issue 목록을 표시한다.

- [x] **Step 4: 설정 누락 UI를 구현한다**

필수 키가 없으면 변수명과 `.env` 경로를 표시하고 `설정 파일 열기` 버튼을 제공한다. 토큰 값은 renderer로 보내지 않는다.

- [x] **Step 5: 타입 검사와 production build를 실행한다**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run build`
Expected: 세 webpack target 모두 성공.

- [x] **Step 6: 커밋한다**

```text
💄Design(Many): String ID 생성 전용 화면 추가
```

### Task 8: 통합 검증과 Windows PoC 빌드

**Files:**
- Modify: `README.md`
- Modify: `PATCH_NOTES.md`

**Interfaces:**
- Consumes: 완성된 앱과 `.env.example`
- Produces: 설치형·portable Windows PoC artifact

- [x] **Step 1: 전체 자동 검증을 실행한다**

Run: `npm test`
Expected: 모든 테스트 PASS.

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run build`
Expected: PASS.

- [x] **Step 2: 비파괴 smoke test를 수행한다**

개발 `.env`가 준비된 경우 Figma 예시의 `%stringTag` 7개와 `메인_외형 챌린지 선택` 프레임을 읽는다. Confluence 쓰기는 지정된 테스트 페이지가 없으므로 fixture storage에 대해 생성 payload와 preview를 검증한다. GDD는 임시 fixture 폴더를 사용한다.

- [x] **Step 3: 사용법과 PoC 제한을 문서화한다**

README와 패치 노트에 `.env` 위치, 필요한 키, 위키/Figma 입력, 영문 검수 대기, 최종 확정, Git 미지원, 백업 경로를 기록한다.

- [x] **Step 4: Windows artifact를 생성한다**

Run: `npm run dist:all`
Expected: `dist/String-Finder-<version>-x64.exe`와 `dist/String-Finder-<version>-portable.exe`가 생성되고 설치 파일 내부에 `.env`가 없다.

- [x] **Step 5: artifact를 확인한다**

설치형과 portable을 각각 실행해 검색 화면, String ID 탭, 설정 파일 열기, 상태 badge, 앱 재실행을 확인한다. `dist` 압축 해제 목록에서 `.env`가 없고 `.env.example`만 있는지 확인한다.

- [ ] **Step 6: 커밋한다**

```text
✏️Docs(README.md, PATCH_NOTES.md): L10N PoC 사용법과 제한사항 추가
```
