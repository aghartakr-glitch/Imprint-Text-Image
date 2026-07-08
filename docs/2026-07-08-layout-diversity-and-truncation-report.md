# 문제 보고서: Imprint(Image+Text) 레이아웃 반복 + 텍스트 잘림

**작성일**: 2026-07-08
**대상**: 다른 코딩 어시스턴트(Codex 등)에게 2차 검토를 요청하기 위한 자료
**저장소**: Imprint(Image+Text) (`server/`, `src/core/`)

## 1. 사용자가 관찰한 증상

1. 이미지 3장을 넣고 생성했는데, 여러 번 시도해도 **"이미지 3장을 한 줄 격자로 배치 + 아래 본문"** 구성만 반복해서 나옴. 사용자가 준비한 1,000개 레퍼런스 데이터셋에는 hero+support, 2페이지 분산, 좌우 분할 등 훨씬 다양한 구성이 있는데 전혀 반영되지 않는 것처럼 보임.
2. 같은 요청에서 **크레딧(비용)은 실제로 차감**되었는데도 결과물은 여전히 "고정 템플릿"처럼 보임 — AI가 실제로 판단해서 나온 결과가 아니라 비상용 대체 로직이 계속 쓰이는 것 아니냐는 의심.
3. 렌더링된 PDF에서 영어 단어가 **중간에 잘려서 다음 줄/페이지로 넘어가는 현상** 발견 (예: "Shorts" → "rts"로 잘림).

## 2. 지금까지 실제로 확인/수정한 것 (시간순)

| # | 원인 | 근거 | 조치 |
|---|---|---|---|
| 1 | 검증 실패 시 재시도가 **전체 프롬프트를 다시 통째로 재전송**해서 실패할 때마다 비용이 3배까지 뜀 | 코드 리뷰로 확인 | `retryLayoutCandidate()`가 존재했지만 실제로 연결이 안 되어 있었음 → 연결함 (이후 재시도 자체를 아예 제거, 아래 참고) |
| 2 | 예산 상한($0.03)이 재시도 여지를 안 줘서 검증 실패 시 항상 fallback으로 떨어짐 | 예산 계산으로 확인 | 상한 0.03→0.05로 상향 (사용자 승인) |
| 3 | 재시도 자체가 "실패해도 돈만 두 번 나감" 구조였음 | 사용자 피드백 | **재시도를 완전히 제거**. 1회 시도 실패 시 무조건 무료 fallback으로 전환. 예산도 다시 0.03으로 원복 |
| 4 | fallback(비상용 틀)이 **이미지 개수당 딱 1가지 고정 모양**만 가지고 있었음 | 코드 리뷰로 확인 — `fallbackLayoutPlan.js`의 3~6장 분기가 항상 동일한 grid 배치 1개만 반환 | 3가지 실제 변형(grid gallery / hero+support / 2페이지 분산)을 추가하고, 실제 이미지 비율 + 본문 길이를 해시해 결정론적으로 선택하도록 변경 |
| 5 | **실제 생성 로그 확인 결과**: LLM이 응답을 쓰다가 `max_tokens=1200` 한도에 정확히 걸려서 JSON이 중간에 잘림 → 파싱 실패 → 이미 낸 돈은 낭비되고 fallback 사용 | `generation-log.json`의 `llm_cost_budget.calls[0].actualOutputTokens === maxOutputTokens === 1200` 확인 | 프롬프트에 "모든 reason은 8단어 이내로" 지시 추가 + `max_tokens` 1200→1600으로 소폭 상향 |
| 6 | **또 다른 실제 로그 확인 결과**: LLM이 `style` 필드에 스키마 예시에 있던 `"Editorial \| Magazine \| Exhibition Catalog"`라는 **옵션 나열 텍스트를 그대로 복사**해서 검증 실패 (`알 수 없는 style: Editorial \| Magazine \| Exhibition Catalog`) | `generation-log.json`의 `internal_candidates[].rejection_reason` 확인 | 스키마 예시의 모든 enum 필드를 `"A \| B \| C"` placeholder 대신 **실제 유효한 값 하나**(`style: "Editorial"` 등)로 교체. 시스템 프롬프트에 "`\|`로 구분된 옵션 목록은 값이 아니라 선택지"라는 문구 명시 추가 |
| 7 | 렌더링된 텍스트가 단어 중간에서 잘림 (`"Shorts"` → `"Sho"` + `"rts"`) | 스크린샷 2회 반복 관찰 + 코드 확인 — `paginateGridPlan.js`가 `text.slice(0, capacity)`로 글자 수만 세서 자름, 단어 경계 고려 없음 | `sliceAtWordBoundary()` 헬퍼 추가 — capacity 안에서 가장 가까운 공백/줄바꿈까지만 자르도록 수정 |

## 3. 지금 시점에서 실제로 검증된 것

- 로컬(mock 모드, 비용 없음)에서 이미지 3장 조합 3가지를 서로 다르게 넣었을 때 **실제로 다른 배치**(2페이지 분산형 / hero+support / grid gallery)가 나오는 것을 XeLaTeX 실컴파일로 확인함.
- 위 6번 문제(placeholder 복사)와 7번 문제(단어 잘림)는 **실제 생성 로그와 스크린샷에서 원인을 특정**했고, 코드 수정 + 회귀 테스트(`buildLayoutPrompt.test.js`, `paginateGridPlan.test.js`) 추가까지 완료. 172개 테스트 통과.
- 단, **6번·7번 수정 이후의 실제 유료 API 호출로 재현 테스트는 아직 안 함** (비용 절감 방침상 실 API 반복 호출을 피하고 있음). 사용자가 다음 실제 생성에서 여전히 문제가 재현되는지 확인이 필요함.

## 4. 아직 불확실하거나 추가로 봐야 할 것

1. **6번 수정이 실제로 검증을 통과하는지**: `style`뿐 아니라 `output_unit`, `layout_family`, `layout_purpose`, `image_hierarchy`, `image_text_relation`, `composition_strategy` 등 다른 enum 필드에서도 같은 방식으로 placeholder를 복사할 가능성이 있음. 스키마 예시 자체는 전부 실제 값으로 고쳤지만, **모델이 실제로 개선된 프롬프트에 어떻게 반응하는지는 실 API 호출 없이는 확신할 수 없음.**
2. **LLM이 실제로 성공했을 때도 결과가 너무 비슷한지**: 지금까지 확인된 실패 사례는 전부 fallback으로 떨어진 경우였음. LLM이 검증을 통과해서 진짜로 결과를 낸 사례가 다양한 구성을 보이는지는 별도로 확인 필요.
3. **`internalCandidateCount=1`로 줄인 것의 영향**: 비용 절감을 위해 내부 후보를 3개→1개로 줄였는데, 이 때문에 애초에 "여러 후보 중 다양성 있는 것 선택" 메커니즘 자체가 거의 작동하지 않는 상태. 후보 다양성을 높이려면 비용이 다시 올라감 — 트레이드오프.
4. **재시도 완전 제거의 부작용**: 이제 LLM이 한 번이라도 실수하면 바로 fallback으로 넘어가므로, fallback의 품질(4번 항목에서 개선함)이 실제 체감 품질을 크게 좌우하게 됨.

## 5. 관련 파일

- `src/core/buildLayoutPrompt.js` — 시스템/사용자 프롬프트, 스키마 예시
- `src/core/callLayoutLLM.js` — LLM 호출 오케스트레이션 (현재: 1회 시도, 재시도 없음)
- `src/core/generateLayoutCandidates.js` — 실제 API 호출, `max_tokens` 설정
- `src/core/layoutCostBudget.js` — 비용 예산 관리 ($0.03 상한)
- `src/core/fallbackLayoutPlan.js` — 결정론적 fallback (다중 변형)
- `src/core/paginateGridPlan.js` — 본문 텍스트 분배/오버플로우 (단어 경계 처리)
- `src/core/validateLayoutPlan.js` — LLM 응답 검증 로직
- `outputs/<타임스탬프>/generation-log.json` — 매 생성마다 남는 전체 진단 로그 (source, cost, rejection_reason 등 전부 기록됨 — 문제 재현 시 가장 먼저 확인할 파일)

## 6. Codex에게 요청하고 싶은 것 (제안)

1. 위 6번 수정(스키마 예시에서 `\|` placeholder 제거)이 **다른 프롬프트 엔지니어링 관점에서 충분한지**, 혹은 더 확실한 방법(예: JSON Schema의 `enum` 필드를 별도 구조로 명시, structured output/tool-use 강제 등)이 있는지 검토.
2. `internalCandidateCount=1`로 인한 다양성 저하를 비용을 크게 늘리지 않으면서 개선할 방법이 있는지 (예: 후보는 1개만 받되 여러 개의 짧은 "구성 아이디어"만 먼저 받고 그중 하나만 완전히 전개하는 2단계 방식 등).
3. `generation-log.json`에 이미 충분한 진단 정보(source, cost, rejection_reason, design_sequence)가 쌓이고 있는데, 이를 자동으로 집계해서 "최근 N회 중 fallback 비율", "가장 흔한 rejection_reason" 같은 걸 보여주는 간단한 스크립트가 있으면 다음에 이런 문제를 훨씬 빨리 진단할 수 있을 것 같음 — 필요성 검토.
