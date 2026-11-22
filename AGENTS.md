# 아수라장 코치 (aram-coach) — AI 작업자 안내

이 파일은 Codex/GPT·Claude 등 코딩 AI가 이 저장소를 이어서 작업할 때 먼저 읽는 안내서입니다.

## 사용자와 약속 (꼭 지키기)

- **답변은 항상 한국어.** 사용자에게 보이는 글, 커밋 메시지, 릴리스 노트, 코드 주석 모두 한국어.
- **판단은 AI가 한다.** 증강 점수·아이템 빌드는 사용자의 Claude Code(`claude -p`) 또는 Codex(`codex exec`)가 정한다. 프로그램이 규칙으로 점수를 지어내지 않는다(예전에 휴리스틱 기본 점수를 넣었다가 사용자가 거절해 삭제함). 프로그램은 데이터 수집·계산(남은 골드 등)·표시만 한다.
- **AI API를 직접 호출하지 않는다.** 각자 PC에 로그인된 CLI를 자식 프로세스로 실행한다(사용자 구독 사용, 비용 없음).
- **게임에 주입하지 않는다.** OP.GG처럼 DLL 주입·Overwolf 방식은 쓰지 않는다(Vanguard 정지 위험). 화면 캡처(DXGI)·OCR·Riot 공식 Live Client API·LCU 읽기(GET)만.
- **커밋·푸시·릴리스는 사용자가 "올려줘"라고 할 때만.** 저장소는 비공개(GitHub `limeknit-wq/aram-coach`) 유지.
- 승률 같은 통계를 지어내지 않는다.
- 설치·실행 테스트 때 사용자의 실제 게임 기록(`%TEMP%\lol-aram-mcp\picks.json`, `plan.json`)을 테스트 데이터로 더럽히지 않는다(스모크 테스트는 전용 임시 폴더·포트 사용).

## 무엇을 하는 프로그램인가

리그 오브 레전드 "무작위 총력전: 아수라장(ARAM: Mayhem, 내부 코드명 KIWI)" 도우미.
- 게임 시작 시 AI가 이번 판(내 챔피언·아군·적·귀빈 이벤트) 기준 **증강 점수표**와 **6칸 완성 빌드**를 만든다.
- 게임 중 증강 선택 화면을 **화면 OCR**로 읽어 카드마다 점수·이유를 오버레이/보조 창에 바로 표시한다.
- 카드 클릭을 감지해 고른 증강을 기록하고, 다음 선택·템 추천에 반영한다.
- 죽을 때·증강을 고를 때 AI에게 다시 물어 6칸 빌드를 갱신하고, 가진 하위 아이템을 뺀 남은 골드와 "지금 살 것"을 계산해 보여준다.
- Claude 데스크톱/ChatGPT에 MCP 서버로 연결해 채팅으로도 쓸 수 있다.

## 구조

```
AramCoach.exe (Node 24 SEA 단일 실행 파일)
 ├─ 기본 실행 → 프로그램 모드: 리더 서버 + 화면 감시 + 오버레이/트레이/설정창/보조 창 + 자동 AI 세팅
 ├─ --mcp     → MCP 서버(stdio). 프로그램이 켜져 있으면 그 상태를 공유(팔로워)
 └─ --http    → ChatGPT용 원격 MCP
```

- **리더 선출:** `127.0.0.1:47321`을 잡은 프로세스가 리더. 프로그램(app)이 MCP 서버보다 우선(`/handoff`). 새 버전 프로그램은 옛 버전을 `/quit`으로 끈다.

| 파일 | 역할 |
|---|---|
| `src/main.js` | 진입점, 모드 분기, 설치 확인 |
| `src/coord.js` | 리더 HTTP 서버(`/overlay` `/status` `/settings` `/click` `/resetup` `/handoff` `/quit` `/test/*`…), 게임 감지(`pollGame`), 클릭→선택 확정(`settlePick`), 템 표시 계산(`itemTick`) |
| `src/autosetup.js` | AI CLI 실행(`askAI`), 증강 목록 압축(`catalog`), 픽창 기본 점수표(`prepareChampion`, 챔피언별 캐시), 로딩 후 적 반영(`onGameStart`), 템 추천(`adviseItems`), 상점 목록(`shop`) |
| `src/plan.js` | 점수표 저장/불러오기, 고른 증강(`picks.json`, gameKey별), 선택지 점수 계산(`scoreOffer`) |
| `src/watcher.js` + `src/watcher.ps1` | 화면 감시. PS가 DXGI 캡처→Windows OCR(한국어)→줄 목록 출력, JS가 증강 이름 매칭·카드 칸별 병합·보완 인식 |
| `src/capture.cs` | DXGI Desktop Duplication(전체 화면 게임도 캡처) |
| `src/overlay.cs` + `src/overlay.ps1` | WinForms UI: 게임 위 오버레이(클릭 통과), 트레이, 설정창, 실시간 보조 창(두 번째 모니터), 테스트 게임 창 |
| `src/itembuild.js` | 남은 골드(가진 하위템 차감), 지금 살 것, 한 개만 살 수 있는 계열(신발·최후의 속삭임 등) |
| `src/live.js` / `src/lcu.js` | Riot Live Client API(게임 중), LCU(픽창·로딩 화면, 읽기 전용), 게임 키 |
| `src/data.js` | Data Dragon(챔피언·아이템), 증강/이벤트 데이터 로드 |
| `src/testmode.js` | 게임 없이 테스트: 가짜 게임 상태 + 가짜 게임 창에 실제 위치로 카드 그림 |
| `src/index.js` / `src/ui.js` | MCP 도구·지시문, MCP Apps 위젯 |
| `src/paths.js` | 버전(`APP_VERSION`), exe 내장 리소스 추출 |
| `scripts/build-augments.mjs` | CommunityDragon에서 증강·귀빈 이벤트 데이터 생성 → `data/*.json` |
| `scripts/build-exe.mjs` | esbuild → SEA → postject → rcedit → `dist/AramCoach.exe` |
| `scripts/smoke-test.mjs` | MCP 도구 14개 스모크 테스트 |

### 화면 인식에서 알아낸 것 (중요)
- Windows OCR은 **넓은 영역을 한 번에 읽으면 일부 카드 제목이 깨진다**(예: "축소 엔진"→"入 에지"). 그래서 매 프레임 **카드 제목 띠(세로 33~50%)만 따로** 한 번 더 읽는다. 줄의 y는 화면 전체 기준(0~1).
- 같은 그림도 키우는 크기에 따라 통째로 실패할 수 있어 넓은 영역은 3200/2600px를 번갈아 쓴다.
- 이름이 깨지면 카드 아래 **설명 문장**으로 맞춘다(`matchByDescription`). 카드는 화면 가운데 기준 좌우 대칭이라 빠진 칸 위치를 계산할 수 있다(`recoverMissing`).
- 선택지는 **카드 칸별로 병합**한다: 새로고침 중 뒤집히는 카드는 유지, 바뀐 칸만 교체, 최대 4장.
- 선택 확정: **첫 클릭만 인정**(고른 직후 게임 화면 클릭이 덮어쓰지 않게), 선택 화면이 2.5초 이상 사라지면 확정. 클릭 감지는 UI 스레드와 별도 스레드(10ms).
- 기록: `%TEMP%\lol-aram-mcp\offers.log`(선택지 변화·클릭·보완 인식·못 읽은 칸 글자) → 문제 분석에 먼저 볼 것. 오버레이 오류는 `%LOCALAPPDATA%\AramCoach\overlay.log`.

## 빌드·테스트·설치

```bash
npm install
npm test                                   # 소스로 MCP 스모크 테스트
npm run build:exe                          # dist/AramCoach.exe (약 103MB)
TEST_EXE=dist/AramCoach.exe npm test       # exe로 스모크 테스트 (14개 ✅)
npm run build:augments                     # 증강 데이터 다시 생성
```
- C# 컴파일 확인(빌드 전 빠르게): PowerShell에서 `Add-Type -TypeDefinition ([IO.File]::ReadAllText('src\overlay.cs',[Text.Encoding]::UTF8)) -ReferencedAssemblies System.Windows.Forms,System.Drawing,System.Web.Extensions` — 경고도 오류로 처리되니 쓰지 않는 필드를 남기지 말 것.
- PowerShell 5.1은 BOM 없는 UTF-8 .ps1의 한글을 깨뜨린다. 임시 .ps1을 만들면 BOM을 붙일 것.
- 설치(이 PC): `ARAM_INSTALL_YES=1` 환경 변수로 다운로드 폴더의 exe를 실행하면 `%LOCALAPPDATA%\Programs\AramCoach`에 설치·재실행된다. 설정은 `%LOCALAPPDATA%\AramCoach\settings.json`에 유지.
- 게임 중 재설치는 가능(같은 판이면 고른 증강·점수표 유지, 적 반영 전에 끊겼으면 이어서 세팅)하지만 AI 세팅이 진행 중일 때는 피할 것.
- 릴리스: 사용자가 "올려줘"하면 → 빌드·테스트 → 커밋 → `git push` → `gh release create vX.Y.Z dist/AramCoach.exe --repo limeknit-wq/aram-coach` (한국어 노트, SHA-256 포함) → 받은 파일 해시 확인.

## 현재 상태 (2026-11-22)

- 마지막 커밋·릴리스: **v0.4.5** (`2a684bb`).
- 작업 트리에 **커밋 안 된 v0.4.6~v0.4.8 변경**이 있다(아직 GitHub에 안 올림). 포함 내용:
  - 증강 인식: 제목 띠 별도 OCR, 설명 문장으로 보완, 크기 번갈아 쓰기, 첫 클릭 확정, 클릭 감지 별도 스레드
  - 게임 중 재시작 시 고른 증강 유지(`resetPicks`가 같은 gameKey면 안 지움), 적 반영 전에 끊긴 세팅 이어서
  - 템: 6칸 완성 빌드 전체 표시(✓ 산 것), 칸 다 차면 추천 중지, 가진 하위템 차감한 남은 골드, 지금 살 것, 한 개만 계열 중복 제거
  - 보조 창: 스크롤바 때문에 크기가 반복해서 바뀌던 문제 수정, 글씨 약 15% 크게
  - 테스트 모드(`src/testmode.js`, 가짜 게임 창) — 11/21 작업분, 실제 게임 검증 전
- 실제 게임에서 아직 확인 못 한 것: 위 v0.4.6~0.4.8 전부.

## 다음 작업 (사용자가 고른 순서)

사용자 결정: **"AI 호출이 메인 기능이어야 한다. 증강 정보가 바뀌어도 AI가 바로 쓸 수 있어야 한다."** → 먼저 **증강 데이터 자동 갱신**, 그다음 **증강이 뜰 때마다 AI 판단**.

### 1단계: 증강 데이터 자동 갱신 (진행 예정, 아직 코드 없음)
문제: `data/augments.json`(287개)은 exe 빌드 때 고정. **125개는 수치가 '?'**, 16개는 설명이 거의 없음. 패치로 바뀌어도 새 exe 전까지 반영 안 됨.
계획:
1. `scripts/build-augments.mjs`의 생성 로직을 `src/augdata.js` 같은 런타임 모듈로 옮긴다(스크립트는 그 모듈을 호출하도록).
2. 프로그램 시작 시(하루 한 번) CommunityDragon `https://raw.communitydragon.org/latest/content-metadata.json`의 버전을 확인 → 바뀌었으면 새로 받아 `%LOCALAPPDATA%\AramCoach\data\augments.json`·`events.json`에 저장. `data.js`의 `augments()`/`events()`는 이 파일이 있으면 우선 사용, 없거나 실패하면 exe 내장본.
3. 갱신되면 캐시 무효화: `data.js`의 `cached("augs")`, `autosetup.js`의 `catalog()`(버전 포함) — 챔피언별 기본 점수표 캐시는 `dataVersion`으로 자동 재생성됨.
4. '?' 수치 줄이기: 게임 파일의 스킬 계산값(`dataValues`/`mSpellCalculations`) 파싱 보강. 그래도 빈 것은 영어 LoL 위키(CC BY-SA) 값을 영문 이름(`nameEn`)으로 맞춰 보조로 사용.
5. **화면에서 읽은 실제 설명 저장:** 카드가 뜰 때 OCR로 읽은 카드 설명(칸 x 기준 아래쪽 줄들)을 증강별로 `%LOCALAPPDATA%\AramCoach\data\seen-desc.json`에 저장 → AI 프롬프트(`catalog`)에서 '?'가 있는 설명 대신 사용. 실제 수치라 패치 변화도 바로 따라감.

### 2단계: 증강마다 AI 판단
- 증강이 뜨면 미리 만든 점수표를 즉시 보여주고, 동시에 AI에게 (카드 3장의 실제 설명, 고른 증강, 현재 아이템, 레벨·시간, 성장한 적, 남은 새로고침)을 보내 1순위·새로고침 추천을 받아 약 10초 뒤 덮어쓴다.

## 참고
- 사용자 PC: Windows 11, 화면 배율 200%, 주 모니터 1920×1080 + 세로 보조 모니터, 게임은 전체 화면(game.cfg WindowMode=0) → 오버레이는 안 보이고 보조 창으로 본다.
- 기본 AI 모델: Claude Code는 사용자 기본 모델(현재 Opus 계열), Codex는 `~/.codex/config.toml`의 모델. 설정 `aiModel`로 바꿀 수 있음.
