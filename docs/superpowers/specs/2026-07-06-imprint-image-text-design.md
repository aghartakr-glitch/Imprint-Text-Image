# Imprint(Image+Text) 설계 문서

## 1. 배경 및 목적

`Imprint`(본문 텍스트 조판)와 `Imprint(Cover)`(표지 생성)에 이어, 이미지와 본문 텍스트가 함께 배치되는 편집디자인형 본문 지면을 생성하는 세 번째 독립 시스템. PRD 전문은 `PRD.md` 참고(이 저장소 루트에 함께 둘 예정).

**절대 원칙**: 기존 `Imprint`, `Imprint(Cover)` 프로젝트 폴더는 읽기 전용 참고만 하고 수정하지 않는다. 바탕화면의 새 폴더 `Imprint(Image+Text)/`에 완전히 독립적으로 구축한다.

## 2. 아키텍처

`Imprint(Cover)`와 같은 계열(자매 시스템 통일성, 검증된 패턴 재사용):

- **프론트엔드**: React + Vite SPA, dev 포트 `5175` (Imprint 5173, Cover 5174와 병행 가능하도록)
- **백엔드**: Node 내장 http 서버 `server/index.mjs`, 포트 `8788`. Vite가 `/api`, `/outputs`를 프록시
- **핵심 로직**: UI에 얽매이지 않는 순수 함수 계열을 `src/core/`에 분리 — `analyzeInput`, `inferStyle`, `selectLayoutPattern`, `paginateContent`, `buildLatex`. 각각 독립적으로 테스트 가능해야 함
- **LaTeX 엔진**: XeLaTeX + `fontspec` + `xeCJK` — Cover에서 이미 검증된 조합(한글 자동 줄바꿈, `CJKspace=true`로 어절 공백 유지)
- **PDF→미리보기 변환**: `pdftoppm`(설치 확인됨, TeX Live 2026과 함께 제공)

## 3. 폰트 결정

PRD 지정 "Noto Serif KR"은 이 PC에 정적(static) 폰트 파일이 없고 가변폰트(`NotoSerifKR-VF.ttf`)만 존재한다. Cover 프로젝트 개발 중 가변폰트는 `xdvipdfmx`에서 임베드 실패하는 것이 확인된 바 있다(`project_imprint_cover` 메모리 기록).

- **본문 세리프**: `IBM Plex Serif`(정적 ttf, `Imprint(Cover)/Fonts/Korean/IBM 명조 - IBM_Plex_Serif/`에 이미 존재)로 대체. 코드/로그 주석에 "PRD 지정 Noto Serif KR 대신 정적 폰트 부재로 대체"를 명시
- **제목/구조용 산세리프**: `Noto Sans KR`(정적 Regular/Bold, Windows Fonts에 설치되어 있음 — 프로젝트 자체 `assets/fonts/`에 복사해 시스템 폰트 의존 없이 내장)
- 폰트 파일은 프로젝트 내부 `assets/fonts/`에 직접 복사해 두고, `.sty`에서 `Path=`로 로드(Cover와 동일 패턴). 시스템 설치 폰트에 의존하지 않음

## 4. 생성 파이프라인

```
입력(이미지 1~6장 + 본문 텍스트)
  → 입력 분석(이미지 개수/비율, 텍스트 길이)
  → 스타일 추정 + 후보(A/B/C)별 레이아웃 패턴 선택 [LLM, 실패 시 규칙 폴백]
  → 페이지네이션(텍스트 분량 → 페이지/스프레드 수 결정, 축소 없음)
  → LaTeX 생성(main.tex, 후보별)
  → XeLaTeX 컴파일 → pages.pdf(개별 A5 페이지)
  → pages.pdf를 pdfpages(`nup=2x1`)로 감싸 spread-preview.pdf 생성
  → 결과/로그 저장
```

### 4.1 입력 분석
- 이미지 개수, 각 이미지의 실제 가로세로 비율(디코딩 없이 헤더만 읽어 판별)
- 본문 글자 수(공백 포함/제외 둘 다 기록)

### 4.2 스타일 추정 + 패턴 선택 (LLM 우선, 규칙 폴백)
- **패턴 라이브러리**: `templates/pattern-presets/`에 이미지 개수 구간(1장 / 2장 / 3~4장 / 5~6장) × 후보 타입(A: image-first / B: balanced / C: text-first) 조합의 JSON 프리셋. 각 프리셋은 페이지별 이미지 슬롯 위치·크기(mm)와 텍스트 블록 존을 정의
- **LLM 호출**: 입력 분석 요약(이미지 개수/비율, 텍스트 길이)을 Claude API에 전달해 구조화 JSON으로 스타일(Editorial/Magazine/Exhibition Catalog)과 후보별 패턴 힌트를 받음. 모델은 `claude-sonnet-4-6`(비용/성능 균형) 사용
- **규칙 폴백**: `ANTHROPIC_API_KEY` 부재 또는 `MOCK_MODE=true`일 때 PRD 4.4의 규칙(이미지 적고 본문 길면 Editorial 등)으로 결정론적 대체. 시스템은 API 키 없이도 항상 동작해야 함
- `generation-log.json`에 실제 LLM 사용 여부, 원문 응답 또는 폴백 사유를 기록

### 4.3 페이지네이션
- 텍스트 블록의 mm 크기 → 9pt 본문/14pt 행간 기준으로 줄당 글자수·페이지당 줄수를 계산해 결정론적으로 텍스트를 흘려보냄
- 한 스프레드에 다 안 들어가면 이미지 없는 텍스트 전용 연속 페이지를 추가(같은 여백/폰트 유지, 축소 금지)

### 4.4 LaTeX 생성 및 컴파일
- Cover와 동일한 `{{PLACEHOLDER}}` 치환 방식의 `.tex`/`.sty` 템플릿
- 후보별로 `main.tex` 1개만 저장 산출물로 남기고, spread-preview 생성용 보조 `.tex`는 임시 파일로 처리 후 삭제
- `twoside` 문서 옵션 + 안쪽/바깥쪽 비대칭 여백으로 제본 여백 처리

## 5. 출력 및 로깅 구조

PRD 7장에 정의된 구조를 그대로 따른다.

```
outputs/2026-07-06_1030_001/
  input/images/*, input/input-text.txt
  candidate-a_image-first/{pages.pdf, spread-preview.pdf, main.tex, layout.json}
  candidate-b_balanced/{...}
  candidate-c_text-first/{...}
  generation-log.json
```

`generation-log.json`은 PRD 7.3 스키마를 따르되, LLM 사용 여부/모델/폴백 사유 필드를 추가한다.

## 6. 오류 처리

- LaTeX 컴파일 실패: `-halt-on-error`로 즉시 중단시키지 않고 `-interaction=nonstopmode`로 실행 후 로그 마지막 부분을 저장(Cover의 `compile.mjs` 패턴 재사용). 실패 원인(폰트 로드 실패/문법 오류 등)을 `generation-log.json`에 구분 기록
- XeLaTeX 미설치: 명확한 안내 메시지와 함께 graceful하게 실패
- LLM 호출 실패(네트워크/키/응답 파싱 오류): 규칙 기반 폴백으로 자동 전환, 사유를 로그에 기록
- 이미지 파일 손상/미지원 형식: 업로드 단계에서 검증 후 사용자에게 어떤 파일이 문제인지 안내

## 7. 검증(테스트) 계획

- **단위 테스트**: `src/core/`의 순수 함수들(입력 분석, 페이지네이션 계산, 규칙 기반 폴백)을 실제 API 호출 없이 검증
- **엔드투엔드 검증**: 실제 사진 없이 플레이스홀더 이미지(비율이 다른 3~4장, 단색/도형 도식 이미지)와 임의의 한글 더미 본문 텍스트를 생성해 전체 파이프라인 1회 실행 → Candidate A/B/C 각각의 `pages.pdf`/`spread-preview.pdf`가 실제로 생성되는지 확인
- **LLM 실제 호출은 최소화**: 반복 검증은 `MOCK_MODE=true`(규칙 폴백)로 수행하고, 최종 1회만 실제 API 키로 검증(과거 세션에서 "검증 목적으로 실제 Claude API 반복 호출 금지" 피드백이 있었음)

## 8. MVP 범위 재확인 (PRD 그대로)

- A5 세로형, 2페이지 스프레드, 이미지 1~6장, 캡션 없음, 원본 비율 유지, 텍스트-이미지 오버레이 없음
- Candidate A(이미지 중심)/B(균형)/C(텍스트 중심) 3종 고정 생성
- 본문 넘침 시 축소 없이 페이지/스프레드 확장
- 비범위: 기존 Imprint/Imprint(Cover) 수정, 텍스트 오버레이, 캡션, 자유형 좌표, 웹 배포/로그인, 표지 생성, 복잡한 표/인포그래픽
