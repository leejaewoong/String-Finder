# L10N 피쳐 선택과 타입 판별 보정 설계

## 목적

기존 String ID 생성 PoC에서 잘못 추론되던 피쳐를 작업자가 한 번 지정하도록 바꾸고, ORDO 컴포넌트 구조를 이용해 Type 판별을 보정한다. 기존 키 자동 재사용 범위는 COMMON과 legacy COMMON 역할의 `ui_dev.json`으로 제한한다.

## 피쳐 입력

- 한 위키 작업은 하나의 `FEATURE PREFIX`를 공유한다.
- 선택지는 현재 GDD `input/ui_*.json`의 실제 String ID 키에서 FEATURE 부분을 추출해 만든다. 파일명에서 prefix를 추측하지 않는다.
- 사용자는 목록에 없는 신규 prefix도 직접 입력할 수 있다.
- 입력값은 대문자 영문, 숫자, `_`만 허용하며 draft에 저장해 탭 이동과 앱 재실행 후에도 유지한다.
- `RELEASE DATE`는 계속 마지막 입력 필드다.
- 다음 prefix는 선택지에서 제외한다.

```text
CG, CW, DUALMATCHMAKING, F2POUTGAME, LABS, LPCSTORE, MASTERY, MFRIEND,
MINIPASS1, MISSION_TOOLTIP, MM, NEWJEANS, NEWSPAGE, SURVIVORPASS3,
SURVIVORPASS4-SURVIVORPASS34, USAGEPOLICYINFO, WORSKHOP, ZK,
AIROYALE02, AIROYALE03, AR, BP, BP2, BP3, CONSOLE, CONSOLEBUYPASSPOPUP,
CONSOLECNP, CONSOLELOGINEVENT, CONSOLESEASON, CPP2, CROWDPLAY,
CUSTOMIZATION, FT, GCOINJP, INVITE, KANGAROO, LPC, MAINTENANCE,
MARKETINGWEBEVENT, MODIFICATION, OPENSOURCE, PGI, PS4, RF, RG, SALESITEM,
SEASON, SEASON9, SEASON10, SEASON12, TRAININGMODETEST, ULABS, WM, WN, XB,
XIMBAN, MAP
```

현재 데이터 기준 선택지는 56개다. 제외는 신규 작업의 선택지에만 적용하며 기존 키 검색에서는 제외 prefix의 키도 검사한다.

## 대상 JSON 결정

- 추출된 prefix가 한 파일에만 있으면 그 파일을 사용한다.
- 중복 prefix는 현재 데이터에서 확인한 기본 매핑을 사용한다.
  - `ARCADE → ui_Arcade.json`
  - `EOM → ui_EOM.json`
  - `LOBBY → ui_lobby.json`
  - `PREVIEW → ui_preview.json`
  - `RANK → ui_rank.json`
  - `REPUTATION → ui_lobby.json`
  - `STORE → ui_store.json`
  - `TOS → ui_dev.json`
- 신규 prefix는 `ui_<prefix lowercase>.json`을 대상으로 계산한다.
- 최종 JSON 반영 시 대상 파일이 실제로 없으면 해당 항목만 `TARGET_FILE_MISSING`으로 남기며 파일을 자동 생성하지 않는다.

## 화면과 Type 추론

- FEATURE는 사용자의 입력값을 그대로 사용한다. LLM이 FEATURE를 선택하지 않는다.
- SCREEN은 프레임명, 레이어 경로, 활성 내비게이션과 타이틀 문맥을 이용해 LLM이 제안한다.
- Type은 Figma의 컴포넌트/레이어 경로에 따른 결정적 규칙을 먼저 적용하고, 규칙이 없을 때만 LLM 결과를 사용한다.
- `LNB`를 허용 Type에 추가한다.
- `Side Tab`은 `BUTTON`이다.
- `Contents Switch`와 `Content Switch`는 `BUTTON`이다.
- `LNB`는 `Title` 컴포넌트 안의 `LNB` 오토레이아웃 아래에 있는 버튼 텍스트만 해당한다. 경로에 `LNB`라는 단어만 있는 경우에는 LNB로 강제하지 않는다.
- 기존 String ID와 스트링 태그 ID 힌트는 약한 참고 정보이며, 위 컴포넌트 구조 규칙을 덮어쓰지 못한다.

## 기존 키 재사용과 COMMON 추천

- 영문이 있으면 영문 `Text + Type`을 우선한다. 영문이 비어 있을 때만 국문 `Text + Type`을 사용한다.
- 자동 재사용 검색 범위는 `ui_common.json`과 `ui_dev.json`이다.
- COMMON 일치 키가 있으면 COMMON을 먼저 선택하고, 없을 때 DEV 일치 키를 선택한다.
- 같은 범위에서 후보가 여러 개면 최신 `ReleaseDate`, 그다음 String ID 오름차순으로 선택한다.
- 위키에 사용자가 작성한 ID가 있어도 같은 Text와 Type의 COMMON/DEV 키가 있으면 재사용 키를 추천한다.
- COMMON/DEV 재사용 후보가 없고 같은 영문 Text와 Type이 선택 피쳐를 제외한 서로 다른 일반 피쳐 JSON 두 곳 이상에 있으면 신규 COMMON 키를 추천한다.
- `ui_common.json`, `ui_dev.json`, 선택 피쳐의 대상 파일은 위 두 곳 계산에서 제외한다.
- 다른 일반 피쳐의 키는 COMMON 판단의 근거로만 사용하며 자동 재사용하지 않는다.
- 사용자가 작성한 유효한 ID는 COMMON/DEV 우선 규칙과 실제 충돌이 없는 한 유지한다.

## Release Date 입력

- 완성된 위키 URL 또는 Figma URL이 입력되면 400ms 대기 없이 즉시 날짜 조회를 시작한다.
- 수동 날짜가 실제로 채워져 있을 때만 자동 제안을 막는다. 저장된 source가 `manual`이어도 날짜가 비어 있으면 다시 자동 제안한다.
- 늦게 끝난 이전 요청은 최신 입력값을 덮어쓰지 않는다.
- 날짜 입력의 캘린더 아이콘은 어두운 배경에서 흰색으로 표시한다.

## 검증 기준

- 최종 선택지에서 `DUALMATCHMAKING`을 포함한 제외 prefix가 보이지 않는다.
- 파일명과 실제 키 prefix가 다른 경우에도 올바른 대상 JSON을 고른다.
- 선택 FEATURE가 모든 신규 후보에 사용되고 SCREEN만 LLM 결과를 따른다.
- Side Tab/Contents Switch/LNB 경로 테스트가 구조 규칙대로 통과한다.
- COMMON 우선, DEV fallback, 다른 두 피쳐의 COMMON 추천, 한국어 fallback이 각각 테스트된다.
- 위키 URL 입력 직후 날짜 조회 조건이 성립하고 빈 수동 날짜가 자동 제안을 막지 않는다.
- 전체 테스트, 타입 검사, production build가 통과한다.
