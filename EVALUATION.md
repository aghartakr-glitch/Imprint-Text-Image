# Imprint(Image+Text) 평가 계획 (v0.4 지시서 20장)

이 문서는 **실행된 실험 결과가 아니라 평가 설계 계획**이다. 실제 사용자 스터디·전문가 인터뷰는
수행하지 않았다(수행하려면 실제 사용자 모집, 다수의 실제 편집 지면 인풋, 시간이 필요하며 이
세션의 범위를 벗어난다). 향후 이 시스템을 연구용으로 검증하고 싶을 때 바로 쓸 수 있도록 조건과
측정 항목만 미리 정의해 둔다.

## 조건 (Condition A~E)

현재 코드베이스는 **Condition E**(가장 완전한 조건)까지 구현되어 있다. A~D는 실험을 위해
파이프라인 일부를 의도적으로 끄면 재현할 수 있다.

| 조건 | 구성 | 이 코드베이스에서 재현하는 방법 |
|---|---|---|
| A | LLM only | `validateLayoutPlan`/`repairLayoutPlan`을 우회하고 LLM 원본 출력을 바로 렌더링 |
| B | LLM + validation | `refineLayout`/`estimateLayoutQuality` 호출을 건너뛰고 validation만 적용 |
| C | LLM + validation + refinement | `estimateLayoutQuality`/`selectBestLayout`을 생략하고 후보 1개만 생성 |
| D | LLM + validation + refinement + estimator | `retrieveLayoutReferences`를 빈 배열로 고정 |
| E | LLM + retrieval + validation + refinement + estimator | 현재 기본 파이프라인 (`server/runGeneration.mjs`) |

## 측정 항목

1. text/image overlap count — `validateLayoutPlan`의 겹침 이슈 개수로 자동 집계 가능
2. page overflow count — `paginateGridPlan`이 생성한 continuation page 개수
3. missing image count — `validateLayoutPlan`의 "이미지가 배치되지 않았습니다" 이슈 개수
4. missing body count — `validateLayoutPlan`의 "본문 텍스트 영역이 존재하지 않습니다" 이슈 개수
5. text readability score — `estimateLayoutQuality`의 `readability` 하위 점수
6. visual balance score — `estimateLayoutQuality`의 `visual_balance` 하위 점수
7. hierarchy score — `estimateLayoutQuality`의 `hierarchy` 하위 점수
8. user correction count — `logUserFeedback.js`에 기록되는 편집 횟수 (편집 UI가 있어야 실제로 쌓임)
9. task completion time — 실제 사용자 스터디에서만 측정 가능 (미실행)
10. expert rating — 아래 전문가 평가 항목 참고, 실제 전문가 섭외 필요 (미실행)

## 전문가 평가 항목 (7점 척도 제안)

1. 이미지와 본문의 관계가 자연스러운가?
2. 본문 가독성이 충분한가?
3. 이미지 위계가 명확한가?
4. 지면의 여백이 안정적인가?
5. 편집디자인 지면처럼 보이는가?
6. 결과가 너무 반복적이지 않은가?
7. 사용자가 수정하기 쉬운가? (현재는 수정 UI 자체가 없어 "아니오"가 기본값 — 향후 개선 과제)

## 현재 상태에서 자동으로 뽑을 수 있는 것 / 없는 것

- **자동 가능**: 1~7번 (매 생성마다 `generation-log.json`에 이미 기록됨)
- **불가능(현재)**: 8번은 편집 UI가 없어 실제 데이터가 쌓이지 않음, 9~10번은 사람이 필요
- 여러 번 생성을 반복해 1~7번 지표를 조건별로 집계하는 스크립트는 만들지 않았다(실 사용자 없이
  합성 반복만으로는 큰 의미가 없다고 판단). 실제 평가를 시작할 때는
  `generation-log.json`들을 모아 집계하는 별도 스크립트를 새로 작성하는 것을 권장한다.
