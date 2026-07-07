# Imprint(Image+Text)

이미지 1~6장 + 본문 텍스트를 넣으면, 입력 조건(이미지 개수·비율, 본문 길이, 제목 유무)을 분석해
**가장 적합한 편집디자인 A5 레이아웃 1개**를 만드는 독립 시스템. 이전에는 Candidate A/B/C 세 가지를
동시에 만들었지만, 지금은 LLM(또는 API 키가 없을 때 규칙 기반 폴백)이 스타일·레이아웃 성격
(image-first/balanced/text-first)·패턴 하나를 직접 판단해서 결과 1개만 낸다. 자세한 배경은
`PRD.md` 0장 참고.
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

`ANTHROPIC_API_KEY`가 없거나 `MOCK_MODE=true`면 실제 Claude API를 호출하지 않고 규칙 기반으로
레이아웃을 결정한다(검증/반복 테스트용). LLM이 실제로 스타일·레이아웃·패턴을 판단하게 하려면
`.env.local`에 유효한 `ANTHROPIC_API_KEY`가 있어야 한다.

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
