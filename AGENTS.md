# 공통 개발 지침

## 프로젝트 개요

- Vampire Survivors 변형 스타일의 2D 탑다운 로그라이크 액션 게임이다.
- TypeScript, Phaser 3, Vite와 npm을 사용한다.
- 게임 화면은 1280×720, 게임 월드는 3000×3000이다.

## 개발 규칙

- 기존 기능이 정상적으로 동작하도록 유지한다.
- 요청하지 않은 기능을 임의로 추가하지 않는다.
- 기존 코드 구조와 작성 방식을 최대한 따른다.
- 별도 요청이 없으면 외부 이미지 리소스를 사용하지 않는다. 사용자가 제공한 스프라이트 원본의 가공본은 [UI 지침](docs/ui/AGENTS.md)과 [스프라이트 가이드](docs/SpriteGenerationGuide.md) 13절에 따라 사용한다.
- 불필요한 추상화, 의존성, 복잡한 구조를 추가하지 않는다.
- 요청한 작업과 관계없는 파일을 수정하지 않고, 기존 미커밋 변경을 보존한다.

## 분야별 개발 지침

작업을 시작하면 아래 연결표에서 수정할 분야를 찾아 해당 지침을 먼저 읽고, 함께 적힌 테스트를 확인한다. 여러 분야에 걸치면 관련 지침을 모두 읽는다. 특히 `src/battle.ts`는 여러 분야의 판정을 함께 담당하므로 수정한 처리가 속한 분야를 기준으로 고른다.

- 플레이어 공통 이동·자동 공격·피격 방침은 [docs/Player/AGENTS.md](docs/Player/AGENTS.md)를 참고한다.
- 직업별 시작 능력치·패시브·특기와 보류 구상은 [docs/Classes/AGENTS.md](docs/Classes/AGENTS.md)를 참고한다.
- 적의 생성·행동·전투 방침은 [docs/Enemy/AGENTS.md](docs/Enemy/AGENTS.md)를 참고한다.
- 경험치·레벨과 레벨업 보상은 [docs/Progression/AGENTS.md](docs/Progression/AGENTS.md)를 참고한다.
- 전투 시뮬레이션·충돌·투사체의 공통 값과 테스트는 [docs/Combat/AGENTS.md](docs/Combat/AGENTS.md)를 참고한다.
- UI 관련 방침은 [docs/ui/AGENTS.md](docs/ui/AGENTS.md)를 참고한다.
- 스프라이트 제작 규격과 제공 원본의 가공·재가공 절차는 [docs/SpriteGenerationGuide.md](docs/SpriteGenerationGuide.md)를 참고한다.
- 규칙과 수치가 정해진 경위는 [docs/Decisions.md](docs/Decisions.md)에 기록한다.

### 작업 분야별 연결표

코드는 `src/`, 테스트는 `tests/<이름>.test.mjs` 기준이다.

| 작업 분야 | 주요 코드 | 지침 | 테스트 |
| --- | --- | --- | --- |
| 플레이어 이동·장애물 충돌·맵 배치 | `collision.ts`, `dungeon.ts`, `dungeon-layout.ts`, `render-depth.ts`, `battle.ts` | Player · Combat | `collision`, `dungeon-layout`, `battle` |
| 적 추적·경로 탐색 | `navigation.ts`, `battle.ts` | Enemy · Combat | `navigation`, `battle` |
| 시간 진행·투사체·일시정지 | `battle.ts`, `battle-geometry.ts`, `battle-config.ts`의 `BATTLE_CONFIG` | Combat · Player | `projectiles`, `battle` |
| 직업·특기·소환물 | `battle-config.ts`의 `CHARACTER_STATS`·`SKILL_CONFIG`, `rewards.ts`, `battle.ts` | Classes · Player · Progression | `classes`, `necromancer`, `rewards` |
| 적 생성·보스·가호 | `battle-config.ts`의 `ENEMY_STATS`·`SPAWN_*`·`BOSS_CONFIG`·`BLESS_CONFIG`, `battle.ts` | Enemy · Combat | `waves`, `boss`, `blessings`, `battle` |
| 경험치·레벨·보상 | `experience.ts`, `rewards.ts`, `battle.ts` | Progression · Classes | `experience`, `rewards`, `battle` |
| 화면 흐름·HUD·선택창 | `main.ts`, `menu-scenes.ts` | UI | 자동 테스트 없음. 실제 실행으로 확인 |
| 스프라이트 표시·애니메이션 | `sprite-animation.ts`, `sprite-view.ts`, `warlock-animation.ts`, `main.ts` | UI · 스프라이트 가이드 13절 · Combat의 '일시정지와 재개'(표시 전용 기록) | `sprite-application`, `warlock-sprite` |
| 스프라이트 가공 | `sprite/profiles/`, `scripts/process-sprites.ps1`, `scripts/sprite-processor.cs` | 스프라이트 가이드 13절 | `sprite-pipeline`(Windows 전용) |

## 코드 구조와 책임

새 로직은 아래 책임에 맞는 곳에 둔다. 현재 구조를 설명하며, 구조를 바꾸는 근거로 쓰지 않는다.

- **`Battle`(`src/battle.ts`):** 게임 상태와 모든 판정을 담당하며 Phaser에 의존하지 않는다. 시간은 `update(delta, …)`로 받은 경과 시간만, 난수는 생성자의 `random` 옵션만 사용하므로 테스트가 둘을 직접 제어한다.
- **`GameScene`(`src/main.ts`):** 입력을 `Battle.update`로 전달하고 `Battle`의 상태를 화면에 동기화한다. 판정이나 수치 계산을 하지 않는다. 타이틀·캐릭터 선택은 `src/menu-scenes.ts`에서 관리한다.
- **`src/battle-config.ts`:** 직업·적·생성·보스·가호·투사체·특기의 기본 수치.
- **`src/rewards.ts`·`src/experience.ts`:** 보상·특기 정의, 보상에 따른 능력치 계산과 선택지 구성 / 레벨업 필요량과 경험치 누적.
- **애니메이션(`src/sprite-animation.ts`·`src/sprite-view.ts`·`src/warlock-animation.ts`):** `Battle`의 표시 전용 기록을 읽어 재생만 하며 판정의 시점과 결과를 바꾸지 않는다.
- **스프라이트 자산:** 원본(`sprite/`, `sprite/used/`)은 읽기만 한다. 셀·기준점·재생 속도는 `sprite/profiles/`의 설정을 고치고 `npm run sprites:process`로 `public/assets/sprites/`를 다시 만든다. 생성된 PNG·JSON을 직접 고치지 않는다.

## 문서 관리 규칙

- 같은 규칙이나 수치는 한 분야 지침에만 쓰고, 다른 문서에서는 링크로 참조한다. 계산 예시나 파생 표(구슬 수, 워록 기준 값 등)는 둘 수 있으나, 원본 위치와 원본이 바뀌면 다시 계산한다는 조건을 함께 적는다. `docs/Decisions.md`의 과거 수치는 변경 이력이므로 갱신 대상이 아니다.
- 코드의 수치나 동작을 바꾸면 그 값을 기록한 지침도 같은 작업에서 갱신한다.
- 사용자가 결정한 설계 사항은 해당 분야 지침에 반영하고, 결정 경위는 `docs/Decisions.md`에 기록한다.
- **단위:** 코드 내부 시간은 ms(`attackMs`, `hurtMs`, `lifeMs` 등)이고 문서에는 초로 표시한다. 공격 간격 등 시간 값의 정수 반올림은 ms 단위에서 한다. 거리·크기는 px, 속도는 px/초다. 적 사거리 표의 설계 단위(1 = 40px)와 코드의 px 값을 구분한다.
- **구현 계획서(`docs/*ImplementationPlan.md`):** 머리에 상태(초안·승인·구현 중·완료·보류·폐기), 기준 커밋, 대체 문서(없으면 '없음')를 적는다. 확정 규칙의 원본은 계획서가 아니라 분야 지침이다. 구현을 마치거나 폐기하면 확정 내용을 분야 지침과 `docs/Decisions.md`로 옮기고, 계획서를 삭제할 때는 그 계획서를 가리키는 링크도 같은 작업에서 정리한다.
- 문서를 수정하면 로컬 Markdown 링크의 대상 파일이 있는지 확인한다.

## 테스트 개발 규칙

### 테스트 실행 환경

- `npm test`는 Node 내장 테스트 실행기(`node --test`)로 `*.test.mjs` 파일을 실행하고, `src`의 `.ts` 파일을 직접 불러온다. Node 22.18 이상(23.x는 23.6 이상)이 필요하다.
- 테스트가 불러오는 모듈은 값 import에 `.ts` 확장자를 붙인다. 또한 `enum`, `namespace`, 생성자 매개변수 속성처럼 타입 제거만으로 실행할 수 없는 문법을 쓰지 않는다. 둘 다 `npm run build`는 통과하지만 `npm test`는 실패한다.
- `tests/sprite-pipeline.test.mjs`는 Windows PowerShell로 가공기를 실행하므로 Windows가 아니면 건너뛴다. 다른 환경의 통과 결과에는 이 검사를 미검증으로 적는다.

### 코드 변경 시 테스트 관리

- 기능을 추가하거나 기존 코드를 수정할 때는 해당 기능과 관련된 테스트 코드를 반드시 확인하고, 변경에 맞춰 테스트도 함께 검토·갱신한다.
- 코드 변경이 기존 테스트에 영향을 줄 수 있으면 테스트를 실행해 결과를 확인한다.
- 새로운 기능을 추가하면 필요한 테스트를 함께 작성한다. 문서나 단순 표현만 바꾸는 작업은 불필요한 테스트를 늘리지 않고 해당 결과를 직접 확인한다.
- 기능의 요구사항이나 의도된 동작이 변경되었으면 새로운 동작에 맞게 기존 테스트를 수정하고, 기대값을 바꾼 근거를 보고한다.
- 기존 기능의 동작이 변경되지 않았는데 테스트가 실패하면 테스트를 고쳐 통과시키지 않고 구현 코드의 문제를 먼저 조사한다.
- 테스트를 수정할 때는 기존 검증 목적을 유지한다. 테스트를 임의로 삭제하거나, 통과시키기 위해 검증 조건을 삭제·완화하거나, 실패한 기대값을 현재 구현 결과에 맞춰 낮추지 않는다.

### 테스트 작성 기준

- 체력, 피해량, 경험치 등 수치를 계산하는 로직은 가능한 한 자동화된 테스트로 검증한다.
- 테스트는 요구사항에 따른 입력과 기대 결과를 명시하고 관찰 가능한 동작을 검증한다. 내부 구현을 그대로 복제하거나 객체 생성 여부만으로 기능 정상 동작을 판단하지 않는다.
- 버그 수정 시 먼저 수정 전 코드에서 실패하는 최소 재현 테스트를 만들고, 수정 후 해당 테스트와 기존 회귀 검사를 모두 통과시킨다.
- 정상 동작과 함께 해당 기능의 경계 조건·실패 조건·반복 실행 시 부작용을 검사한다. 공통 로직을 바꾸면 이를 사용하는 기능 간 연동도 확인한다.
- 시간·난수·외부 상태에 의존하는 테스트는 필요한 입력을 직접 제어한다. 실제 대기나 실행 환경에 따라 결과가 달라지지 않게 하고, 핵심 검증 로직 자체를 모의 처리하지 않는다.
- 수치 비교에 허용 오차가 필요하면 근거와 범위를 명시한다.

### 실행과 보고

- 코드 수정이 완료되면 관련 테스트와 TypeScript 빌드(`npm run build`)를 실행하고 기존 회귀 검사를 확인한다. 테스트·타입 검사·빌드·실제 실행 결과를 구분해 보고한다.
- 테스트에 실패하면 실패 원인을 보고하고 해결한다. 해결하지 못한 실패는 원인과 함께 남은 문제로 명시한다.
- 실행한 명령, 검증한 범위, 남은 실패와 확인하지 못한 항목을 간단히 기록한다. 실행하지 못한 테스트는 실행한 것처럼 보고하지 않는다. 기능별 검사 조건은 분야별 지침에서 관리한다.

## 작업 완료 시 확인

- 게임 코드 변경 시 `npm run build`로 TypeScript 타입 검사와 Vite 빌드 오류를 확인한다.
- 변경한 기능을 실행해 정상 동작과 기존 기능에 미치는 영향을 확인한다.
- 이동·전투·충돌·배치·시간 처리 등 테스트 대상 로직을 변경하면 `npm test`로 관련 회귀 검사를 실행한다.
- 변경 내용과 검증 결과를 간단하게 설명하고, 확인하지 못한 항목은 명시한다.
- Windows PowerShell에서 npm이 실행 정책에 차단되면 `npm.cmd`를 사용한다.

## Git 규칙

- 별도 요청 없이 커밋하지 않는다.
- 커밋 요청 시 변경 내역을 확인하고 해당 작업과 관련된 변경만 포함한다.
- 관계없는 변경을 덮어쓰거나 되돌리지 않는다.
