# Imprint(Image+Text)

이미지 1~6장 + 본문 텍스트를 A5 편집디자인형 스프레드 3종(이미지 중심/균형/텍스트 중심)으로 만드는 독립 시스템.
`Imprint`(본문 텍스트 전용), `Imprint(Cover)`(표지)의 자매 시스템이며, 두 프로젝트의 코드는 이 저장소에서 읽기 전용으로만 참고했다.

## 실행 방법

```bash
npm install
cp .env.example .env.local   # ANTHROPIC_API_KEY를 넣으면 LLM 기반 스타일 추정, 없으면 규칙 기반 폴백
npm run dev:all              # Vite(5175) + 백엔드(8788) 동시 실행
```

브라우저에서 http://localhost:5175 접속 후 이미지 1~6장과 본문 텍스트를 넣고 Generate를 누르면
`outputs/<타임스탬프>/`에 후보 A/B/C별 `pages.pdf`, `spread-preview.pdf`, `main.tex`, `layout.json`과
`generation-log.json`이 생성된다.

`MOCK_MODE=true`로 실행하면 실제 Claude API를 호출하지 않고 규칙 기반 스타일 추정만 사용한다(검증/반복 테스트용).

## 테스트

```bash
npm test
```

`src/core/`의 순수 로직은 목(mock) 기반, `server/`의 컴파일·오케스트레이션 테스트는 실제 XeLaTeX를 호출한다.

## 폴더 구조

```
Imprint(Image+Text)/
├─ src/core/          입력 분석, 스타일 추정, 패턴 선택, 페이지네이션, LaTeX 조립 (순수 함수)
├─ server/             HTTP 서버, XeLaTeX 컴파일, 출력 폴더/로그 저장, 전체 오케스트레이션
├─ src/frontend/        React UI (업로드 폼, Generate 버튼, 결과 보기)
├─ templates/           .tex/.sty 템플릿 + 패턴 프리셋 JSON
├─ assets/fonts/        IBM Plex Serif(본문 세리프 대체), Noto Sans KR(제목/구조용)
├─ uploads/             업로드된 원본 이미지(임시)
├─ outputs/             생성 결과 (타임스탬프 폴더별)
└─ docs/superpowers/    설계 스펙 + 구현 계획 문서
```

## 폰트에 대한 참고

PRD는 본문 세리프로 "Noto Serif KR"을 지정하지만, 이 폰트는 정적(static) 빌드가 없고
가변폰트(variable font)만 배포되어 XeLaTeX(xdvipdfmx)에서 임베드에 실패한다. 대신 정적 빌드가
있는 **IBM Plex Serif**를 본문 세리프로 사용한다. 자세한 배경은
`docs/superpowers/specs/2026-07-06-imprint-image-text-design.md` 3장 참고.
