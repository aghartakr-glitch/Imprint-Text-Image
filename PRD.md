# Imprint(Image+Text)

## 0. 개정 사항 (2026-07-07) — Candidate A/B/C 폐지, 최적 레이아웃 1개로 변경

아래 원본 PRD(1~12장)는 초기 버전이며, 실제 구현은 이후 사용자 지시로 다음과 같이 개정되었다.
**이 0장이 최신 사양이고, 본문 중 "Candidate A/B/C" 관련 내용은 모두 이 개정 사항으로 대체된다.**

- **세 가지 후보(Candidate A/B/C) 동시 생성 금지.** 입력(이미지 개수·비율, 본문 길이, 제목 유무)을 분석해
  **가장 적합한 레이아웃 1개만** 생성한다. 출력 폴더도 `candidate-a_image-first/` 등 3개가 아니라
  `best-layout/` 1개다.
- **LLM의 역할이 실질적 판단으로 바뀜.** 기존에는 LLM이 "스타일" 이름만 고르고 실제 페이지 구성(패턴)은
  이미지 개수로만 고정 조회했다. 개정 후에는 LLM(또는 API 키 없을 때 규칙 기반 폴백)이 다음 3가지를
  실제로 판단한다: ① 스타일(Editorial/Magazine/Exhibition Catalog), ② 레이아웃 성격
  (image-first/balanced/text-first), ③ 미리 정의된 패턴 라이브러리에서 pattern_id 하나. 실제 mm 좌표
  계산·페이지네이션·PDF 생성은 그 결정을 받아 코드가 결정론적으로 처리한다(LLM이 좌표를 직접 만들지 않음).
- **제목은 별도 지면에 고정되지 않는다.** (이 부분은 별도 논의로 이미 반영됨: 제목이 있으면 이미지 없는
  섹션 오프너 페이지가 본문 앞에 추가되고, 없으면 기존과 동일.)
- **LLM 응답 검증 실패 시 규칙 기반 폴백**으로 전환한다(JSON 파싱, 허용된 style/layout_type 값, pattern_id가
  available_patterns 안에 실재하는지, 그 pattern_id의 layoutType과 응답의 layout_type이 일치하는지 등을 검증).
- **`generation-log.json` 스키마 변경**: 후보별 정보 대신 `selection_mode: "best_only"`,
  `selected_layout_type`, `selected_style`, `selected_pattern_id`, `selection_reason`,
  `input.image_ratios`, `input.text_density`, `validation.passed/issues` 등을 기록한다.
- 실제 구현 위치: `src/core/selectLayout.js`(LLM 판단 + 검증), `src/core/layoutTypeRules.js`(규칙 기반
  폴백), `src/core/textDensity.js`(short/medium/long 판정), `src/core/generateBestLayout.js`(선택된
  패턴 1개로 실제 레이아웃 생성), `server/runGeneration.mjs`(전체 흐름).

---

## 1. 프로젝트 개요

### 1.1 프로젝트명
Imprint(Image+Text)

### 1.2 목적
Imprint(Image+Text)는 **이미지와 본문 텍스트가 함께 배치된 편집디자인형 본문 레이아웃**을 생성하는 시스템이다.
기존의 다음 시스템과는 역할이 다르다.

- **Imprint**: 텍스트만 있는 본문 조판
- **Imprint(Cover)**: 표지 생성
- **Imprint(Image+Text)**: 이미지 + 텍스트가 함께 있는 본문 조판

### 1.3 핵심 원칙
- **기존 Imprint / Imprint(Cover) 코드는 절대 수정하지 않는다.**
- 바탕화면에 **새로운 독립 폴더**를 생성해 별도 시스템으로 구축한다.
- 최종 출력은 **LaTeX 기반 PDF 컴파일**이어야 한다.
- 결과는 **편집디자인 지면**처럼 보여야 하며, 단순 문서 배치가 아니라 **이미지와 텍스트가 조화롭게 들어간 본문 지면**이어야 한다.

---

## 2. 개발 범위

## 2.1 MVP 범위
이번 버전은 아래 범위까지만 구현한다.

- A5 세로형(portrait) 기준
- 2페이지 스프레드 생성
- 사용자 입력 이미지 **1~6장**
- 본문 텍스트 입력
- 캡션 없음
- 이미지는 원본 비율 유지
- 텍스트를 이미지 위에 올리지 않음
- 스타일 자동 추정
- 결과 후보 3개 생성
  - Candidate A: 이미지 중심
  - Candidate B: 균형형
  - Candidate C: 텍스트 중심
- 본문이 1개 스프레드에 다 안 들어가면 **자동 축소하지 않고 다음 페이지/다음 스프레드로 넘김**
- 출력 시 **A5 개별 페이지 PDF**와 **스프레드 미리보기 PDF**를 모두 생성
- 생성할 때마다 output folder에 자동 로깅

## 2.2 비범위(Non-goals)
이번 MVP에서는 아래 기능은 구현하지 않는다.

- 기존 Imprint / Imprint(Cover) 코드 통합 및 수정
- 이미지 위에 텍스트 오버레이
- 캡션 입력 및 캡션 자동 생성
- 완전 자유형 좌표 생성
- 고급 이미지 크롭 편집 UI
- 사용자가 직접 모든 요소 좌표를 수동 조정하는 편집기
- 웹 배포 / 로그인 / 사용자 계정 기능
- 표지 생성 기능
- 본문 안의 복잡한 표, 도표, 인포그래픽 자동 생성

---

## 3. 사용자 시나리오

## 3.1 기본 사용자 흐름
1. 사용자가 이미지 1~6장을 업로드한다.
2. 사용자가 본문 텍스트를 입력한다.
3. 시스템이 이미지 개수, 이미지 비율, 텍스트 길이, 지면 조건을 분석한다.
4. 시스템이 스타일을 자동 추정한다.
   - Editorial
   - Magazine
   - Exhibition Catalog
5. 시스템이 미리 정의된 레이아웃 패턴 중 적절한 후보를 선택한다.
6. 시스템이 Candidate A / B / C 세 가지 결과를 생성한다.
7. 각 후보를 LaTeX로 컴파일한다.
8. 다음 파일들을 저장한다.
   - 개별 페이지 PDF
   - 스프레드 미리보기 PDF
   - LaTeX 소스
   - layout.json
   - generation-log.json
   - 입력 이미지 사본
   - 입력 텍스트 사본

---

## 4. 기능 요구사항

## 4.1 입력
시스템은 아래 입력을 받아야 한다.

### 필수 입력
- 이미지 파일 1~6장
- 본문 텍스트

### 고정값 / 시스템 기본값
- 판형: A5
- 방향: portrait
- 캡션: 사용 안 함
- 이미지 피팅: 원본 비율 유지
- 텍스트 이미지 오버레이: 허용하지 않음
- 결과 후보 수: 3개
- 스타일: 자동 추정

---

## 4.2 출력
각 생성 시 아래 산출물을 만들어야 한다.

### 후보별 산출물
각 Candidate(A/B/C)마다:

- `pages.pdf`
  - A5 개별 페이지 기준 PDF
- `spread-preview.pdf`
  - 스프레드 미리보기 PDF
- `main.tex`
- `layout.json`

### 전체 산출물
생성 1회당:

- 입력 이미지 복사본
- 입력 텍스트 파일
- `generation-log.json`

---

## 4.3 레이아웃 후보
시스템은 반드시 아래 3가지 후보를 생성해야 한다.

### Candidate A: Image-first
- 이미지를 상대적으로 더 크게 사용
- 본문은 가독성 확보 범위 안에서 보조적으로 배치
- 사진집/도록형에 가까운 인상 가능

### Candidate B: Balanced
- 이미지와 본문이 균형감 있게 배치
- 가장 기본적인 편집디자인형 결과
- MVP에서 가장 표준적인 결과 후보

### Candidate C: Text-first
- 본문 가독성을 우선
- 이미지는 보조적 요소로 배치
- 정보 전달 중심 레이아웃

---

## 4.4 스타일 자동 추정
스타일은 사용자가 직접 선택하지 않고 시스템이 자동 판단한다.

### 가능한 스타일 클래스
- Editorial
- Magazine
- Exhibition Catalog

### 자동 추정 기준 예시
- 이미지 수가 적고 본문이 길다 → Editorial 가능성 높음
- 이미지 수가 많고 리듬감 있는 배치가 적합하다 → Magazine 가능성 높음
- 이미지가 크게 쓰이고 도록/전시 같은 인상이 적합하다 → Exhibition Catalog 가능성 높음

### 주의
- 스타일 자동 추정은 "절대적 정답 분류"가 아니라 **레이아웃 성격을 결정하는 내부 판단 로직**이다.
- generation-log.json에 자동 추정 결과를 기록해야 한다.

---

## 4.5 타이포그래피 기본값

### 폰트
- 본문용 Serif: `Noto Serif KR`
- 제목/보조 헤더용 Sans: `Noto Sans KR`

### 기본 조판값
- 본문 크기: `9pt`
- 행간: `14pt`

### 기본 사용 원칙
- 본문은 기본적으로 Noto Serif KR 사용
- 페이지 번호, 헤더, 짧은 구조 표시 등은 Noto Sans KR 사용 가능
- 임의 축소 금지
- 텍스트가 많다고 해서 본문 크기/행간을 자동으로 줄이지 않는다

---

## 4.6 여백 및 지면 규격

### 지면
- A5 portrait
- 페이지 크기: `148mm × 210mm`
- 2페이지 스프레드 미리보기 기준: `296mm × 210mm`

### 여백
- 상단: `16mm`
- 하단: `18mm`
- 안쪽: `18mm`
- 바깥쪽: `14mm`

### 주의
- 안쪽 여백은 제본을 고려해 바깥보다 넓게 유지
- 모든 후보는 동일한 기본 여백 체계를 공유하되, 내부 레이아웃은 패턴에 따라 달라질 수 있음

---

## 4.7 본문 넘침 처리
본문이 한 스프레드에 다 들어가지 않을 경우:

- 글자 크기를 줄이지 않는다
- 행간을 줄이지 않는다
- 내용을 생략하지 않는다
- **다음 페이지 / 다음 스프레드로 자연스럽게 넘긴다**

즉, 결과물은 1개 스프레드로 고정되지 않고, 필요시 여러 스프레드로 확장되어야 한다.

---

## 4.8 이미지 처리 규칙

### 기본 규칙
- 이미지 수: 1~6장
- 이미지는 원본 비율 유지
- 텍스트는 이미지 위에 올라가지 않음
- 캡션은 없음

### 레이아웃상 고려해야 할 점
- 이미지가 한 면을 가득 채우는 경우
- 한 면에 이미지 2개가 들어가는 경우
- 3개 이상이 그리드/리듬감 있게 배치되는 경우
- 이미지 수와 비율에 따라 적절한 텍스트 블록 확보

### 주의
- "원본 비율 유지"는 이미지 왜곡 금지를 의미함
- 이미지 크롭은 최소화하며, 비율 왜곡은 절대 금지
- 텍스트와 이미지가 너무 가까워 답답해 보이지 않도록 여백을 확보해야 함

---

## 5. 레이아웃 시스템 설계 원칙

## 5.1 방식
이 시스템은 **완전 자유형이 아닌 반자동형**으로 구현한다.

즉,
- LLM 또는 규칙 기반 판단이 **레이아웃 패턴을 선택**
- 선택된 패턴 안에서 이미지/텍스트 블록의 크기와 위치를 조정
- 최종적으로 LaTeX 좌표 혹은 박스 구조로 변환

## 5.2 권장 구조
레이아웃 생성은 아래 흐름을 따른다.

1. 입력 분석
   - 이미지 개수
   - 이미지 비율
   - 텍스트 길이
2. 스타일 자동 추정
3. 후보별 레이아웃 패턴 선택
4. 텍스트 블록/이미지 블록 크기 배분
5. 페이지 수 계산
6. LaTeX 코드 생성
7. PDF 컴파일
8. 결과 저장 및 로그 기록

---

## 5.3 패턴 라이브러리
개발 시, **미리 정의된 레이아웃 패턴 라이브러리**를 만들어야 한다.

예시:

### 이미지 1장
- 한쪽 페이지 full image + 반대쪽 본문
- 상단 큰 이미지 + 하단 본문
- 왼쪽 이미지 / 오른쪽 본문
- 이미지 강조형 / 본문 강조형 변형

### 이미지 2장
- 좌우 분할형
- 상하 분할형
- 큰 이미지 1개 + 작은 이미지 1개
- 2이미지 + 본문 영역 분리형

### 이미지 3~4장
- 균등 그리드형
- 대표 이미지 + 보조 이미지형
- 한 페이지 이미지군 + 한 페이지 본문형
- 리듬형 갤러리형

### 이미지 5~6장
- 소형 그리드형
- 모듈형 반복 배치
- 잡지/도록형 이미지 군집 배치
- 여러 스프레드 분산형

---

## 6. 기술 요구사항

## 6.1 독립 프로젝트로 생성
반드시 바탕화면에 아래 새 폴더를 만들 것:

`Imprint(Image+Text)`

기존 Imprint / Imprint(Cover) 프로젝트를 복사 참고할 수는 있어도,
**기존 폴더 내부 파일을 직접 수정하는 방식은 금지**한다.

---

## 6.2 권장 디렉토리 구조
아래 구조를 기본안으로 사용한다.

```txt
Imprint(Image+Text)/
├─ app/
│  ├─ frontend/
│  └─ server/
├─ scripts/
│  ├─ analyzeInput.js
│  ├─ inferStyle.js
│  ├─ selectLayoutPattern.js
│  ├─ paginateContent.js
│  ├─ buildLatex.js
│  ├─ compileLatex.js
│  └─ saveOutputs.js
├─ templates/
│  ├─ main.tex
│  ├─ styles/
│  └─ pattern-presets/
├─ uploads/
├─ outputs/
├─ logs/
├─ package.json
├─ README.md
└─ PRD.md
```

## 6.3 LaTeX 기반
출력은 반드시 LaTeX 컴파일을 거쳐야 한다.
사용 가능 패키지 예시

- `graphicx`
- `geometry`
- `textpos`
- `tikz`
- `paracol`
- `multicol`
- `adjustbox`
- 기타 필요한 패키지

구현 원칙

- 단순 워드 프로세서식 배치가 아니라 편집지면처럼 보여야 함
- 이미지와 본문의 관계가 명확해야 함
- 페이지를 넘기더라도 조판 질서가 무너지지 않아야 함

---

## 7. 저장 및 로깅 요구사항

## 7.1 생성마다 output folder 자동 생성
Imprint(Cover)처럼 결과 생성 시마다 output folder에 자동 저장되어야 한다.

폴더명 예시

`outputs/2026-07-06_1030_001/`

## 7.2 저장 구조 예시

```
outputs/
└─ 2026-07-06_1030_001/
   ├─ input/
   │  ├─ images/
   │  │  ├─ image1.jpg
   │  │  ├─ image2.jpg
   │  │  └─ ...
   │  └─ input-text.txt
   ├─ candidate-a_image-first/
   │  ├─ pages.pdf
   │  ├─ spread-preview.pdf
   │  ├─ main.tex
   │  └─ layout.json
   ├─ candidate-b_balanced/
   │  ├─ pages.pdf
   │  ├─ spread-preview.pdf
   │  ├─ main.tex
   │  └─ layout.json
   ├─ candidate-c_text-first/
   │  ├─ pages.pdf
   │  ├─ spread-preview.pdf
   │  ├─ main.tex
   │  └─ layout.json
   └─ generation-log.json
```

## 7.3 generation-log.json 기록 항목
최소한 아래 정보를 저장할 것.

```json
{
  "project": "Imprint(Image+Text)",
  "created_at": "2026-07-06_1030_001",
  "input": {
    "image_count": 4,
    "image_names": ["image1.jpg", "image2.jpg", "image3.jpg", "image4.jpg"],
    "text_length": 3200,
    "page_size": "A5",
    "orientation": "portrait",
    "caption": false,
    "image_fit": "contain",
    "text_overlay": false
  },
  "layout_settings": {
    "candidates": ["A", "B", "C"],
    "candidate_meanings": {
      "A": "image-first",
      "B": "balanced",
      "C": "text-first"
    },
    "style_inference": "Editorial",
    "body_font": "Noto Serif KR",
    "heading_font": "Noto Sans KR",
    "body_font_size_pt": 9,
    "body_leading_pt": 14,
    "margins_mm": {
      "top": 16,
      "bottom": 18,
      "inner": 18,
      "outer": 14
    }
  },
  "overflow_policy": {
    "auto_shrink": false,
    "move_to_next_page": true,
    "move_to_next_spread": true
  },
  "outputs": {
    "candidate_a": "candidate-a_image-first/",
    "candidate_b": "candidate-b_balanced/",
    "candidate_c": "candidate-c_text-first/"
  }
}
```

---

## 8. UI / 실행 방식 요구사항

## 8.1 최소 실행 형태
MVP에서는 아래 중 편한 방식으로 구현 가능하다.

- 로컬 웹 UI
- 간단한 데스크톱형 로컬 UI
- 최소한의 입력 폼을 가진 로컬 실행 화면

최소 UI 요소

- 이미지 업로드
- 본문 텍스트 입력
- Generate 버튼
- 생성 완료 후 output folder 경로 또는 결과 목록 확인

중요

UI보다 중요한 것은 정상적인 입력 처리, 후보 생성, LaTeX 출력, 로깅이다.

---

## 9. 품질 기준 / 성공 기준

## 9.1 필수 성공 기준
아래가 충족되면 MVP 성공으로 본다.

1. 기존 Imprint / Imprint(Cover)를 수정하지 않고 독립 프로젝트로 생성되었다.
2. 이미지 1~6장 + 본문 텍스트 입력이 가능하다.
3. A5 portrait 2페이지 스프레드 기반 결과가 생성된다.
4. Candidate A / B / C 세 가지 결과가 생성된다.
5. 각 후보에 대해 pages.pdf 와 spread-preview.pdf 가 생성된다.
6. 본문이 길 경우 자동 축소 없이 다음 페이지/다음 스프레드로 넘어간다.
7. output folder에 생성 결과와 로그가 자동 저장된다.
8. 최종 PDF가 LaTeX 기반으로 컴파일된다.
9. 결과물이 최소한 "이미지와 텍스트가 어울리는 편집디자인형 지면"으로 보인다.

## 9.2 품질 평가 관점
에이전트는 아래를 기준으로 결과를 확인할 것.

- 이미지와 텍스트의 균형
- 본문 가독성
- 여백 안정성
- 그리드 감각
- 이미지 배치 리듬
- 후보 간 성격 차이 명확성
- 여러 페이지로 넘어갈 때의 안정성

---

## 10. 구현 우선순위

Phase 1

- 새 프로젝트 폴더 생성
- 기본 실행 환경 구성
- 입력 UI 또는 입력 처리 구조 구현
- output folder 자동 생성 로직
- 입력 텍스트 및 이미지 저장

Phase 2

- 이미지 분석 로직
- 텍스트 길이 분석 로직
- 스타일 자동 추정 로직
- 패턴 라이브러리 초안 구현

Phase 3

- Candidate A/B/C 생성 로직
- 페이지네이션
- LaTeX 코드 생성
- PDF 컴파일

Phase 4

- spread-preview 생성
- generation-log.json 저장
- layout.json 저장
- 결과 검증 및 구조 정리

---

## 11. 에이전트 구현 지시사항

반드시 지킬 것

- 기존 Imprint / Imprint(Cover) 코드를 직접 수정하지 말 것
- 바탕화면에 새 폴더 `Imprint(Image+Text)` 생성 후 독립적으로 작업할 것
- 하드코딩만으로 끝내지 말고, 패턴 기반의 확장 가능한 구조로 만들 것
- 이미지 수 1~6장에 대해 깨지지 않게 처리할 것
- 본문이 넘칠 경우 축소하지 말고 페이지를 넘길 것
- output folder 자동 저장 및 generation-log.json 저장을 구현할 것
- Candidate A/B/C의 차이가 실제로 보이도록 만들 것
- LaTeX 컴파일 실패 시 원인을 확인할 수 있도록 로그를 남길 것

권장 구현 방식

- 입력 분석 → 스타일 추정 → 패턴 선택 → 페이지 분배 → LaTeX 생성 → PDF 컴파일 → 저장/로그
- 자유 배치보다 템플릿/패턴 기반 반자동형 접근을 사용할 것
- 첫 구현부터 완벽한 미학보다 구조 안정성, 페이지 흐름, 저장 체계를 우선할 것

---

## 12. 최종 요청

이 PRD를 기준으로 다음을 수행하라.

1. 바탕화면에 `Imprint(Image+Text)` 폴더를 새로 생성한다.
2. 독립 실행 가능한 MVP 시스템을 구축한다.
3. 이미지+텍스트 본문 조판 결과를 LaTeX 기반으로 생성한다.
4. Candidate A/B/C 세 가지 후보를 출력한다.
5. 각 생성마다 output folder에 결과와 로그를 자동 저장한다.
6. README.md에 실행 방법과 폴더 구조를 정리한다.
7. 첫 구현 완료 후, 샘플 입력으로 실제 결과 PDF가 생성되는지 검증한다.
