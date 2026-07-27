# 범용 편집 레이아웃 시스템 — 격차 분석 (2026-07-27)

기준 문서: 사용자 제공 "범용 이미지·텍스트 편집 레이아웃 시스템" 스펙
분석 대상: 현재 `src/core` 전체 + 프롬프트 + LaTeX 렌더링

사용자가 지목한 최대 문제: **이미지와 글이 자연스럽게 관계를 만들지 못한다.**
아래 P0-1, P0-2가 그 직접 원인이다.

---

## P0-1. 레이아웃 스키마에 "콘텐츠 그룹" 단위가 없다 (스펙 §7 위반)

### 현재 상태

LLM이 만드는 레이아웃 요소는 전부 **평평한 독립 박스**다.
`src/core/buildLayoutPrompt.js:155-180` 스키마 예시:

```json
{ "id": "image_1", "type": "image", "role": "hero",  "col_start": 1, "col_span": 4, ... }
{ "id": "para_1",  "type": "text",  "role": "body", "text_source": "paragraph_1", ... }
```

- 이미지에는 **어떤 텍스트와 관련 있는지 표현할 필드가 아예 없다.**
- 텍스트에는 `text_source`(어느 문단인지)만 있고, 어느 이미지에 속하는지 없다.
- 즉 스키마상 이미지와 텍스트는 **같은 그리드를 공유하는 남남**이다.

앞서 추가한 `group_id`는 텍스트 블록에만 존재하고, 프롬프트 안내문 + 사후 검증용으로만 쓰인다.
**이미지는 어떤 그룹에도 속할 수 없다.**

### 스펙 요구사항

> 하나의 콘텐츠 그룹은 이미지 + 제목 + 설명 / 작품 이미지 + 작품 정보 + 캡션 ... 으로 구성될 수 있다.
> 관련된 요소는 공통된 정렬선, 비슷한 너비, 가까운 간격을 사용하여 하나의 그룹으로 인식되게 한다.
> **이미지의 위치를 먼저 정하고 남는 공간에 텍스트를 넣는 방식도 피해야 한다.**

현재 시스템은 스펙이 명시적으로 금지한 바로 그 방식으로 동작한다.

### 필요한 수정

1. 레이아웃 스키마에 `content_group` 개념 1급 도입
   - 이미지/텍스트 요소 모두 `group_id`를 갖는다
   - 그룹 단위로 공통 정렬선(같은 `col_start`/`col_span`)과 인접 배치를 강제
2. 파이프라인 순서 변경: **그룹 구성 → 그룹별 지면 할당 → 그룹 내부 배치**
   (현재: 이미지 배치 → 텍스트로 빈칸 채우기)
3. 그룹 응집 검증을 이미지 포함으로 확장

---

## P0-2. 콘텐츠 종속 하드코딩 (스펙 §1, §10 정면 위반)

시스템 곳곳이 **사용자의 특정 트렌드 리포트 문서 하나**에 맞춰 하드코딩되어 있다.
다른 장르(소설·도록·보고서)에서는 이 로직들이 전부 무력화되거나 오작동한다.

### (a) 텍스트 역할 추론이 브랜드명 기반 — `src/core/content/inferBlockRole.js:4-13`

```js
const KEYWORD_PATTERNS = {
  overview:     ['메가 트렌드', '매크로 트렌드', ...],
  context:      ['초양극화', '대응하고', ...],
  audience:     ['Z세대', '밀레니얼', 'Gen Z', ...],
  protest_case: ['카네기', '시위', 'LGBTQ+', '프라이드', ...],
  brand_case_dove:         ['도브', 'Dove', '#NoDigitalDistortion', ...],
  brand_case_sweaty_betty: ['스웨티 베티', 'Sweaty Betty', 'Wear The Damn Shorts'],
}
```

소설·도록·보고서에는 이 단어들이 없다 → 전부 길이 기반 폴백으로 떨어진다.

### (b) 이미지-텍스트 매칭이 위 역할에만 의존 — `src/core/content/matchImageToTextBlocks.js:14-18`

```js
const caseBlocks    = textBlocks.filter((b) => b.role === 'brand_case')
const protestBlocks = textBlocks.filter((b) => b.role === 'protest_case')
const introBlocks   = textBlocks.filter((b) => ['intro_definition','trend_context','audience_value'].includes(b.role))
```

**(a)가 실패하면 이 세 배열이 전부 비고, 이미지-텍스트 매칭 결과가 0건이 된다.**
→ 이미지와 글이 관계를 못 맺는 가장 직접적인 코드 경로.

### (c) 이미지 내용 추정이 가로세로 비율뿐 — `src/core/content/analyzeImages.js:14-23`

```js
if (orientation === 'landscape' && aspectRatio > 1.5) {
  visual_type = 'crowd_or_protest'   // 가로로 길면 시위 사진이라고 단정
}
```

도록의 가로 작품 사진, 카탈로그의 가로 제품컷이 전부 "시위"로 분류된다.

### (b-2) 하드코딩된 파일 전수 목록 (2026-07-27 전수 조사)

| 파일 | 내용 |
|---|---|
| `content/inferBlockRole.js` | ✅ 교체 완료 (형식 기반) |
| `content/parseTextBlocksAdvanced.js:5-9` | 도브/스웨티베티/카네기/Z세대 키워드 |
| `content/parseContentStructure.js:7-12` | 동일 키워드 정규식 |
| `content/inferImageTextRelations.js:5-7` | 동일 키워드 정규식 |
| `content/matchImageToTextBlocks.js:14-18` | 위 역할에만 의존 (매칭 0건의 원인) |
| `content/analyzeImages.js:14-23` | 가로비율 → `crowd_or_protest` 단정 |
| `content/parseDocumentStructure.js:122,131,145-160` | `hasCases`/`hasIntro` 판정, `analyzeSemanticContent` 키워드 |
| **`buildLayoutPrompt.js:71-79, 252`** | **프롬프트가 LLM에게 직접 "Dove 문단은 Dove 이미지 옆에" 지시** |

마지막 항목이 특히 중요하다 — 코드를 다 고쳐도 프롬프트가 남아있으면
LLM이 계속 특정 브랜드 기준으로 배치를 시도한다.

### (d) 전용 빌더 4개가 특정 문서 섹션명 기반 — `src/core/layout/builders/`

`cmfStoriesMasonry.js`, `macroOpenerSplit.js`, `caseStudyCardsGrid.js`, `numberedStoryHeroSupport.js`
— 사용자 문서의 "CMF STORIES", "Macro-trend", "DESIGN CASE STUDIES" 섹션에 대응하는 이름.

### 필요한 수정

- 의미(브랜드/주제) 기반 → **형식(마크다운 위계·문단 길이·인접성) 기반** 역할 추론으로 전면 교체
- 이미지-텍스트 매칭을 **문서 내 순서·인접성·개수 비율**로 재작성 (내용 무관)
- `visual_type` 추정 제거 또는 비율/방향 정보만 남기고 의미 추정 삭제
- 빌더를 콘텐츠 중립적 구조 이름으로 재정의 (아래 P1-2와 연계)

---

## P1-1. 장르 개념이 시스템에 전혀 없다 (스펙 §3 전체 미구현)

- `src/core/designSpace.js` — genre 어휘 없음
- `src/frontend/App.jsx:169-187` — 사용자 입력은 판형·단수·그리드모드 3개뿐
- 소설/에세이/잡지/도록/보고서 구분이 코드 어디에도 없다

결과: 스펙 §10이 금지한 "모든 장르에 잡지식 콜라주를 적용하는 결과"가 기본 동작이다.

### 필요한 수정

1. `genre` 입력 추가 (UI + `userLayoutSettings`)
2. 장르별 정책 테이블 신설: 기본 단 수, 이미지 최대 비중, 여백 정책, 다단 허용 여부,
   캡션 필수 여부, 풀페이지 이미지 허용 여부
3. 이 정책을 프롬프트 + 검증 + 폴백 빌더 3곳 모두에 주입

---

## P1-2. 레이아웃 패밀리 선택이 "정확한 개수 일치"에 의존

`src/core/layout/selectLayoutFamily.js:56-70`

```js
if (imageCount === 4 && hasCases && relation === 'case_study_cards') { ... }
if (imageCount === 3 && hasNumbered && relation === 'numbered_image_text_pairs') { ... }
```

이미지가 5장이면 두 조건 모두 탈락한다. 스펙이 요구하는
"이미지 개수에 따른 유연한 대응"(§5)과 맞지 않는다.

또한 `designSpace.js`의 `layoutFamilies`(3개: image-first/balanced/text-first)와
`selectLayoutFamily.js`의 `LAYOUT_FAMILIES`(12개)가 **이름만 같고 값이 다른 별개 목록**이라
개념이 이중화되어 있다.

### 필요한 수정

- 정확 일치 → **범위/비율 기반 선택**으로 변경 (예: 이미지당 텍스트량, 이미지 밀도)
- 두 `layoutFamilies` 목록 통합 정리

---

## P1-3. 캡션이 명시적으로 금지되어 있다 (스펙 §3 도록·§7 위반)

`src/core/buildLayoutPrompt.js:37, 44, 194`

```
- Do not generate caption elements.
- Image count: 1 to 6. Captions disabled. ...
- Do not generate captions. Do not place text over images.
```

그러나 목표 디자인에는 캡션이 **핵심 요소**다
(Sweaty Betty / Deepti Khatri / Nike N7 / Patagonia / "Yoko Ono at Gropius Bau, Berlin, 2025" 등).
스펙도 도록에 "작품명, 작가명, 제작 연도, 재료, 크기"를 요구한다.

`designSpace.js`의 `textRoles`에도 caption이 없다.
(`layoutConstants.js`에는 `credit` 역할이 있으나 프롬프트에서 생성이 차단되어 도달 불가)

### 필요한 수정

- `caption` / `credit` 역할을 정식 어휘로 추가하고 프롬프트 금지 해제
- 캡션은 **소속 이미지의 콘텐츠 그룹에 묶어** 배치 (P0-1과 연계)
- 장르별 캡션 정책 (도록: 필수 / 소설: 없음)

---

## P1-4. 이미지가 배정된 칸을 채우지 못한다 (목표 디자인 대비)

`src/core/buildLatex.js:86`

```latex
\includegraphics[width=..mm,height=..mm,keepaspectratio]{...}
```

`keepaspectratio`는 **레터박스** 동작이다. 원본 비율과 칸 비율이 다르면
이미지가 칸보다 작게 렌더되어 한쪽에 빈 공간이 생긴다.

목표 디자인의 이미지들은 **배정된 사각형을 정확히 꽉 채운다**
(특히 4개 균등 카드 그리드, 메이슨리 배치). 이건 crop-to-fill 동작이다.

현재는 그리드를 완벽히 계획해도 렌더 단계에서 가장자리가 어긋난다.

### 필요한 수정

- `fit` 어휘에 `cover`(비율 유지 + 칸 채우기 + 넘치는 부분 크롭) 추가
- `object_position`을 크롭 기준점으로 실제 사용 (현재는 사실상 미사용)
- 도록 장르는 `contain` 유지(작품 잘림 방지), 잡지 장르는 `cover` 기본

---

## P2-1. 이미지 개수 상한 6장

`buildLayoutPrompt.js:44` — "Image count: 1 to 6"
`fallbackLayoutPlan.js:724,731` — `imageCount >= 3 && imageCount <= 6`

목표 스프레드는 한 면에만 6~8장이 들어간다. 스펙 §5 "이미지가 많은 경우"는
여러 페이지 분산을 요구하므로 상한 자체를 없애고 분산 로직으로 대응해야 한다.

---

## P2-2. 텍스트 분량 대응이 문자 수 단일 기준

스펙 §6은 텍스트 양에 따라 단 수·페이지 분할·본문 폭을 조절하라고 요구한다.
현재 `textDensity`는 short/medium/long 3단계이며, **이미지 대비 상대 밀도** 개념이 없다.
"텍스트와 이미지가 모두 많은 경우" 교차 스프레드 전략(§6)은 미구현이다.

---

## 수정 순서 제안

| 순서 | 항목 | 이유 |
|---|---|---|
| 1 | P0-2 하드코딩 제거 | 다른 항목의 전제. 이게 남아있으면 무엇을 고쳐도 특정 문서에서만 동작 |
| 2 | P0-1 콘텐츠 그룹 도입 | 사용자가 지목한 최대 문제의 직접 해결 |
| 3 | P1-3 캡션 허용 | 그룹 스키마 확정 직후 함께 (그룹의 구성원) |
| 4 | P1-1 장르 도입 | 그룹/캡션 정책의 분기 기준 |
| 5 | P1-4 이미지 채움 | 렌더 품질. 위와 독립이라 병행 가능 |
| 6 | P1-2 패밀리 선택 유연화 | 장르 도입 후 함께 정리 |
| 7 | P2-1, P2-2 | 위가 안정된 후 |

---

## 확정된 설계 결정 (2026-07-27 사용자 승인)

### 1. 장르 — 자동 추정 + 사용자 재정의

- 시스템이 문서 구조(마크다운 위계, 문단 길이 분포, 이미지/텍스트 비율)로 장르를 먼저 추정한다
- 추정 결과를 UI에 표시하고, 사용자가 드롭다운으로 덮어쓸 수 있다
- `userLayoutSettings.genre`가 있으면 그 값이 항상 우선, 없으면 추정값 사용
- **추정은 내용(브랜드명·주제)이 아니라 형식 신호만 사용한다** (P0-2 원칙 유지)

### 2. 캡션 — 문단 끝줄 자동 인식 (입력 문법 변경 없음)

- 사용자는 지금처럼 본문 마지막에 짧은 줄을 쓴다 (`Nike N7`, `Patagonia`, `Sweaty Betty`)
- 인식 규칙(형식 기반, 내용 무관):
  - 같은 콘텐츠 그룹의 **마지막** 텍스트 줄이고
  - 앞 문단보다 현저히 짧으며 (문장 종결부호 없음 / 일정 글자 수 이하)
  - 그룹에 이미지가 포함되어 있을 때
  → `caption` 역할로 승격하고 해당 그룹 이미지에 인접 배치
- 오탐 시 손실이 없도록, 캡션으로 승격돼도 **텍스트는 절대 삭제·요약하지 않는다**

### 3. 이미지 채움 — 장르별 자동 분기

| 장르 | 기본 `fit` | 이유 |
|---|---|---|
| 잡지 · 보고서 · 에세이 | `cover` (꽉 채움, 가장자리 크롭) | 그리드 정렬이 깔끔해야 함 |
| 도록 · 포트폴리오 | `contain` (전체 노출) | 작품 잘림이 치명적 |
| 소설 | `contain` | 삽화 성격 |

- `object_position`을 크롭 기준점으로 실제 사용
- 장르 기본값은 사용자가 필요 시 개별 이미지로 덮어쓸 수 있게 여지를 남긴다

### 4. 기존 전용 빌더 4개 — 폐기 후 재작성

- `caseStudyCardsGrid` / `numberedStoryHeroSupport` / `cmfStoriesMasonry` / `macroOpenerSplit` 삭제
- 콘텐츠 중립적인 **구조 기반** 빌더로 대체 (예: 균등 카드 그리드, 히어로+보조, 메이슨리,
  오프너 분할 — 이름과 조건 모두 특정 문서와 무관하게)
- 선택 조건도 "정확히 4장" 같은 개수 일치가 아니라 범위·비율 기반으로 (P1-2와 통합)
