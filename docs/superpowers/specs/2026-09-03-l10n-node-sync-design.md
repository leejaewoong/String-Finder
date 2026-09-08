# L10N Figma Node 기반 위키 동기화 설계

## 목적

Figma를 국문과 태그 구조의 진실 원천으로 사용하면서도 위키에서 작성한 영문, String ID, 비고를 안전하게 보존한다. 프레임마다 구분자가 A부터 반복되는 구조를 지원하고, 신규 프레임·신규 태그·태그 이동·텍스트 변경을 반복 실행으로 최신화한다.

## 식별자

- Frame Identity: `Figma File Key + Frame Node ID`
- String Identity: `Figma File Key + Target Node ID`
- Tag Identity: `Figma File Key + String Tag Node ID`
- 구분자는 표시와 정렬에만 사용하며 영구 식별자로 사용하지 않는다.
- 영문과 String ID는 Tag가 아니라 Target Node에 귀속한다.

## 위키 동기화 메타데이터

- Confluence Content Property `string-finder-l10n-sync`에 schema version, 행 순서, Frame/Target/Tag Node ID, 마지막 구분자와 첨부 파일명을 저장한다.
- 메타데이터는 위키 표의 표시 컬럼을 늘리지 않는다.
- 기존 표에 메타데이터가 없으면 프레임 첨부 파일명과 구분자를 이용해 한 번 마이그레이션한다.
- 앱이 관리하는 구조와 메타데이터를 안전하게 연결할 수 없으면 행을 추측해서 덮어쓰지 않고 확인 필요 항목으로 남긴다.

## 유효한 Figma 작업 대상

다음 조건을 모두 충족한 String Tag만 작업 대상으로 인정한다.

- `%stringTag` payload 파싱 성공
- Target Node 확인 성공
- Target Node에서 국문 추출 성공
- Tag와 Target이 공유하는 내보내기 Frame 확인 성공

유효한 String Tag가 하나 이상 있는 Frame만 위키에 추가하고 이미지를 내보낸다. 단순히 Figma 페이지에 새 Frame이 생긴 경우에는 작업하지 않는다. 같은 Target을 여러 Tag가 가리키면 하나의 행만 유지하고 `중복 타게팅` 확인 항목을 만든다.

## 표 동기화 규칙

### 신규 표

- 컬럼 순서는 `이미지, 구분자, String ID, 영문, 국문, 비고`다.
- 페이지는 full-width, 표는 왼쪽 정렬로 작성한다.
- Frame 이미지는 Frame마다 한 번만 첨부하고 해당 Frame의 모든 행에 rowspan으로 공유한다.

### 기존 Target

- Target Node가 같으면 동일한 스트링으로 취급한다.
- Figma 국문과 구분자를 위키에 반영한다.
- 영문은 항상 보존한다.
- `기존 String ID 사용`으로 자동 재사용된 행에서 국문이 바뀌면 String ID와 해당 자동 비고를 지우고 다시 추천한다.
- 그 밖의 String ID와 사용자 비고는 보존한다.
- Tag Node나 구분자가 바뀌어도 Target Node가 유지되면 영문과 String ID를 함께 이동한다.

### 신규 Target과 신규 Frame

- 새 Target은 해당 Frame 그룹에 새 행으로 추가한다.
- 새 Frame은 유효한 String Tag가 있을 때만 새 이미지 그룹으로 추가한다.
- 새 행은 국문과 구분자를 채우고 영문, String ID, 비고는 비운 상태에서 추천 절차를 진행한다.
- 기존 행의 영문, String ID, 비고는 변경하지 않는다.

### Figma Tag 누락

- 위키 행의 Target Node를 현재 어떤 유효한 Tag도 가리키지 않으면 행을 삭제하지 않는다.
- 행은 기존 Frame 그룹과 기존 위치에 보존하고 구분자만 비운다.
- 국문, 영문, String ID, 비고는 그대로 보존한다.
- `Figma 태그 누락`은 앱의 확인 필요 항목과 내부 메타데이터에만 표시하고 비고 컬럼에는 기록하지 않는다.
- 누락 행은 신규 String ID 생성과 JSON 반영 대상에서는 제외하지만 String ID 충돌 검사와 번호 점유 계산에는 포함한다.
- 누락 Target이 다시 Tag에 연결되면 기존 행에 현재 구분자를 복원하고 영문, String ID, 비고를 유지한다.

## Frame 이미지 최신화

- 신규 Frame, 신규 Tag, Target 이동, 구분자 변경, 국문 변경이 발생한 현재 유효 Frame만 다시 내보낸다.
- 한 Frame에서 여러 변경이 있어도 이미지는 한 번만 내보내고 첨부 파일의 새 버전으로 업로드한다.
- 유효한 Tag가 모두 사라진 Frame은 기존 위키 행과 첨부 이미지를 보존한다.

## SCREEN과 Type 판정

- SCREEN 판정을 위해 내보내기 Frame 전체에서 `TAB`, `TITLE`, `LNB`, `GLOBAL HEADER` 관련 레이어와 컴포넌트를 수집한다.
- 표시 여부, 텍스트, 레이어 경로, 컴포넌트 속성의 `selected`, `active`, `on`, `checked`, `state`, `variant` 값을 LLM 문맥에 제공한다.
- SCREEN 근거 우선순위는 활성 TAB, 활성 LNB, TITLE, GLOBAL HEADER, Frame 이름, Target 레이어 경로 순이다.
- Type은 기존 ORDO 결정 규칙을 우선하고 규칙이 없을 때 LLM 판정을 사용한다.
- Side Tab과 Contents Switch는 `BUTTON`이다.
- `LNB`는 Title 컴포넌트 내부 LNB 오토레이아웃의 버튼만 해당한다.

## String ID 판정과 충돌

- JSON에 이미 존재하는 String ID이고 영문이 JSON Text와 같으면 확정된 재사용 ID로 잠그고 변경하지 않는다.
- 유효한 기작성 String ID가 있으면 그 ID의 Type을 `effectiveType`으로 사용한다. 없으면 LLM Type을 사용한다.
- 기작성 Type과 LLM Type이 다르면 ID를 자동 교체하지 않고 `Type 확인 필요` 항목을 만든다.
- COMMON/XB 재사용과 다른 피처 2개 이상을 근거로 한 COMMON 추천은 `effectiveType`으로 비교한다.
- 영문이 비어 있으면 국문과 `effectiveType`으로 COMMON/XB 재사용 및 COMMON 신규 추천을 검사한다.
- 누락 행의 String ID도 이미 사용 중인 번호로 계산한다.
- 누락 행과 활성 행의 같은 ID가 서로 다른 영문에 사용되면 충돌로 표시하고 활성 행을 다른 번호로 변경한다. 누락 행의 ID는 자동 변경하지 않는다.
- `renumber` 결과는 JSON 반영 전에 위키 String ID 컬럼에 기록한다.

## JSON 반영

- 현재 유효한 Figma Target과 연결된 행만 JSON 반영 대상으로 사용한다.
- Figma Tag 누락 행은 충돌 검사에는 포함하지만 JSON에 새 항목을 만들지 않는다.
- 기존 키 재사용이면 COMMON 여부와 관계없이 JSON에 새 항목을 추가하지 않는다.
- 이미 JSON에 반영된 키는 이후 동기화에서 보존하며 JSON 항목을 자동 삭제하지 않는다.

## 오류 처리

- 한 Tag 또는 한 행의 오류는 전체 작업을 중단하지 않는다.
- 태그 형식 오류, Target Node 누락, 중복 타게팅, 메타데이터 불일치, String ID 충돌, Type 불일치를 각각 확인 필요 항목으로 표시한다.
- Figma 또는 Confluence 페이지 전체 조회 실패와 위키 동시 수정 충돌은 안전한 동기화가 불가능하므로 해당 실행을 실패 처리한다.

## 검증 기준

- 서로 다른 Frame에서 같은 구분자를 사용해도 Target Node 기준으로 정확히 동기화한다.
- 신규 유효 Tag Frame과 신규 Tag 행만 추가된다.
- Tag/구분자 변경 시 데이터가 Target Node를 따라 이동한다.
- 누락 행은 구분자만 비워지고 영문, String ID, 비고가 유지된다.
- 누락 행의 ID가 충돌 검사와 번호 할당에 포함된다.
- Frame 문맥이 LLM SCREEN 입력에 포함된다.
- JSON 확정 ID 잠금과 Type 불일치 확인 항목이 동작한다.
- 전체 테스트, 타입 검사, production build가 통과한다.
