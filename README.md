# Roguelike Starter

TypeScript, Phaser 3, Vite로 구성한 브라우저용 2D 액션 로그라이크 시작 프로젝트입니다.

검증 환경: Node.js 24.19.0, npm 11.17.0, Phaser 3.90.0,
Vite 8.3.4, TypeScript 7.0.2.
Vite의 Node.js 요구 사항은 `^20.19.0 || >=22.12.0`입니다.

## 실행

```sh
npm install
npm run dev
```

브라우저에서 http://127.0.0.1:5173 을 엽니다. 개발 서버는 Ctrl+C로 종료합니다.
PowerShell에서 스크립트 실행 정책 때문에 npm이 차단되면 `npm.cmd`로 실행하세요.

## 빌드

```sh
npm run build
npm run preview
```

`build`는 TypeScript 타입 검사 후 Vite 프로덕션 빌드를 수행합니다.
결과물은 `dist/`에 생성됩니다. 미리보기 주소는 터미널에 표시됩니다.

## 구성

- `src/main.ts`: Phaser 설정과 기본 게임 씬
- `src/style.css`: 화면 배치
- `tsconfig.json`: TypeScript 엄격 타입 검사 설정

게임 내부 해상도는 1280×720이며 브라우저 크기에 맞춰 비율을 유지합니다.
어두운 배경 중앙에 40×40 사각형 플레이어가 표시됩니다.
WASD 또는 방향키를 누르고 있는 동안 초당 280픽셀로 이동합니다.
대각선 속도는 수평·수직 이동과 같으며, 키를 놓으면 즉시 멈춥니다.
플레이어 사각형은 화면 밖으로 나가지 않습니다.
외부 이미지와 전투는 아직 포함하지 않습니다.
