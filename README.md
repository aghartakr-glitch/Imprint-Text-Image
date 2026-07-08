# Imprint(Image+Text)

이미지 1~6장 + 본문 텍스트를 넣으면, 입력 조건(이미지 개수·비율·방향, 본문 길이, 제목 유무)을
LLM이 직접 해석해 **6 columns × 12 rows grid 안에서 layout_plan을 생성**하고, 코드가 이를 검증·
보정·필요시 재요청한 뒤 A5 레이아웃 1개(`best-layout/`)로 변환하는 독립 시스템이다. 페이지 크기·
여백·본문 크기/행간 같은 고정 제약은 LLM이 바꿀 수 없고, mm 좌표 계산은 100% 코드가 담당한다.
LLM은 고정 패턴을 고르는 게 아니라 grid 좌표 자체를 판단한다. 자세한 배경은 `PRD.md` 0.1장,
`imprint_llm_layout_planner_prompt_v0.2.md` 참고.
`Imprint`(본문 텍스트 전용), `Imprint(Cover)`(표지)의 자매 시스템이며, 두 프로젝트의 코드는 이 저장소에서 읽기 전용으로만 참고했다.

## 실행 방법

```bash
npm install
cp .env.example .env.local   # ANTHROPIC_API_KEY를 넣으면 LLM이 실제로 레이아웃을 판단, 없으면 규칙 기반 폴백
npm run dev:all              # Vite(5175) + 백엔드(8788) 동시 실행
```

브라우저에서 http://localhost:5175 접속 후 이미지 1~6장과 본문 텍스트(제목은 선택)를 넣고 Generate를
누르면 `outputs/<타임스탬프>/best-layout/`에 `pages.pdf`, `spread-preview.pdf`, `main.tex`,
`layout.json`과 최상위에 `generation-log.json`이 생성된다.

`ANTHROPIC_API_KEY`가 없거나 `MOCK_MODE=true`면 실제 Claude API를 호출하지 않고 결정론적 grid
폴백(`fallbackLayoutPlan.js`)으로 레이아웃을 결정한다(검증/반복 테스트용). LLM이 실제로 grid
layout_plan을 판단하게 하려면 `.env.local`에 유효한 `ANTHROPIC_API_KEY`가 있어야 하며(또는 UI
헤더의 API 키 입력란에 직접 입력), 응답이 검증에 실패하면 자동 보정 → 최대 2회 재요청 → 그래도
실패하면 같은 폴백을 사용한다.

## 테스트

```bash
npm test
```

`src/core/`의 순수 로직은 목(mock) 기반, `server/`의 컴파일·오케스트레이션 테스트는 실제 XeLaTeX를 호출한다.

## 폴더 구조

```
Imprint(Image+Text)/
├─ src/core/          입력 분석, grid layout_plan 프롬프트/호출/검증/보정/폴백, 페이지네이션, LaTeX 조립
├─ src/data/           패턴 지식베이스(imprint_pattern_library_v0.2.json), 레퍼런스 데이터셋(csv)
├─ server/             HTTP 서버, XeLaTeX 컴파일, 출력 폴더/로그 저장, 전체 오케스트레이션
├─ src/frontend/        React UI (업로드 폼, Generate 버튼, 결과 보기)
├─ templates/           .tex/.sty 템플릿
├─ assets/fonts/        Noto Sans KR (본문 + 제목/구조용)
├─ uploads/             업로드된 원본 이미지(임시)
├─ outputs/             생성 결과 (타임스탬프 폴더별)
└─ docs/superpowers/    설계 스펙 + 구현 계획 문서
```

## 폰트에 대한 참고

PRD는 본문 세리프로 "Noto Serif KR"을 지정하지만, 이 폰트는 정적(static) 빌드가 없고
가변폰트(variable font)만 배포되어 XeLaTeX(xdvipdfmx)에서 임베드에 실패한다. 대체 세리프로
시도한 IBM Plex Serif는 한글 글리프 자체가 없어 본문이 빈 사각형으로 나왔다. 그래서 본문·제목
모두 실제 컴파일로 한글 렌더링이 확인된 **Noto Sans KR**을 사용한다(세리프 대신 산세리프이며,
본문/제목은 크기·굵기로만 구분). 자세한 배경은
`docs/superpowers/specs/2026-07-06-imprint-image-text-design.md` 3장 참고.
