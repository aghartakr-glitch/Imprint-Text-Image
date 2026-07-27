import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paginateGridPlan } from './paginateGridPlan.js'

function onePagePlan() {
  return {
    pages: [{
      page: 1,
      elements: [
        {
          id: 'image_1', type: 'image', role: 'hero', col_start: 1, col_span: 6, row_start: 1, row_span: 6,
        },
        {
          id: 'body_1', type: 'text', role: 'body', col_start: 1, col_span: 6, row_start: 8, row_span: 5,
        },
      ],
    }],
  }
}

function twoPagePlan() {
  return {
    pages: [
      { page: 1, elements: [{
        id: 'image_1', type: 'image', role: 'gallery', col_start: 1, col_span: 6, row_start: 1, row_span: 12,
      }] },
      { page: 2, elements: [{
        id: 'body_1', type: 'text', role: 'body', col_start: 1, col_span: 6, row_start: 1, row_span: 12,
      }] },
    ],
  }
}

test('short text that fits entirely in the plan body box produces no overflow pages', () => {
  const result = paginateGridPlan(onePagePlan(), '가나다')
  assert.equal(result.length, 1)
  assert.equal(result[0].textSlicesByElementId.body_1, '가나다')
})

test('long text overflows into extra full-page continuation pages, all text preserved', () => {
  const longText = '가'.repeat(6000)
  const result = paginateGridPlan(onePagePlan(), longText)
  assert.ok(result.length > 1, 'should produce continuation pages')
  const rebuilt = result.map((p) => Object.values(p.textSlicesByElementId)[0] || '').join('')
  assert.equal(rebuilt, longText)
})

test('a page with no body element gets no text assigned (e.g. a pure gallery page)', () => {
  const result = paginateGridPlan(twoPagePlan(), '본문')
  assert.deepEqual(result[0].textSlicesByElementId, {})
  assert.equal(result[1].textSlicesByElementId.body_1, '본문')
})

test('empty text produces no overflow pages and an empty/null slice', () => {
  const result = paginateGridPlan(onePagePlan(), '')
  assert.equal(result.length, 1)
  assert.equal(result[0].textSlicesByElementId.body_1, null)
})

// Regression guard: a real generation showed "Shorts" split across a page boundary into "Sho" +
// "rts" because slices were cut at a raw character count with no word-boundary awareness.
test('overflow never cuts a slice in the middle of a word (space-delimited text)', () => {
  const words = Array.from({ length: 2000 }, (_, i) => `word${i}`)
  const longText = words.join(' ')
  const result = paginateGridPlan(onePagePlan(), longText)
  assert.ok(result.length > 1, 'should produce continuation pages')

  const slices = result.map((p) => Object.values(p.textSlicesByElementId)[0] || '')
  slices.forEach((slice, i) => {
    if (i < slices.length - 1) {
      // every non-final slice must end at a real word boundary, not mid-word
      assert.ok(/(^$|\S$)/.test(slice), `slice ${i} should not end with trailing whitespace: ${JSON.stringify(slice.slice(-20))}`)
      const lastWord = slice.split(/\s+/).pop()
      assert.ok(words.includes(lastWord) || lastWord === '', `slice ${i} ends mid-word: "${lastWord}"`)
    }
  })

  // Rejoining with single spaces reproduces the original word sequence (whitespace at the cut
  // points is intentionally consumed, not preserved, so this compares word content, not raw bytes).
  const rebuiltWords = slices.join(' ').split(/\s+/).filter(Boolean)
  assert.deepEqual(rebuiltWords, words)
})

// Regression guard: a real generation truncated "CELEBRATE MARGINALISED SOCIETIES AND COMMUNITIES
// TODAY" down to just "CELEBRATE MARGINALISED SOCIETIES" because text was sliced against the
// hardcoded default grid (6 columns) while the plan's actual grid_spec (3 columns here) rendered a
// wider box -- the two disagreed on how much text fit. Passing gridSpec through must make slicing
// use the SAME box dimensions resolveGridPage renders.
test('slices against the plan\'s actual grid_spec, not the hardcoded default grid', () => {
  const gridSpec = { columns: 3, rows: 12, gutterMm: 4 }
  const plan = {
    grid_spec: { columns: 3, rows: 12, gutter_mm: 4 },
    pages: [{
      page: 1,
      elements: [
        {
          id: 'heading_1', type: 'text', role: 'body', text_source: 'paragraph_1', col_start: 1, col_span: 3, row_start: 1, row_span: 1,
        },
        {
          id: 'body_1', type: 'text', role: 'body', text_source: 'paragraph_2', col_start: 1, col_span: 3, row_start: 2, row_span: 5,
        },
      ],
    }],
  }
  const headingText = 'CELEBRATE MARGINALISED SOCIETIES AND COMMUNITIES TODAY'
  const textBlocks = [{ id: 'p1', text: headingText }, { id: 'p2', text: 'body text' }]

  const withoutGridSpec = paginateGridPlan(plan, '', textBlocks)
  assert.notEqual(withoutGridSpec[0].textSlicesByElementId.heading_1, headingText, 'sanity check: reproduces the bug without gridSpec')

  const withGridSpec = paginateGridPlan(plan, '', textBlocks, gridSpec)
  assert.equal(withGridSpec[0].textSlicesByElementId.heading_1, headingText, 'full heading text should be preserved when sliced against the real grid_spec')
})

// Regression: confirmed 2026-07-27 real generation -- a heading (glued to its body paragraph with
// no blank line in the user's input, so they share one group_id) landed alone in the one leftover
// row at the bottom of an overflow page, while its own body paragraph got pushed to the NEXT page,
// reading as if the heading had no content ("floating"). Blocks sharing a group_id must land on the
// same page, adjacent, even when the heading alone would technically have fit in the leftover room.
test('a heading and its group-mate body paragraph (no blank line between them) are never split across an overflow page boundary', () => {
  const plan = { pages: [{ page: 1, elements: [] }] }
  // Sized so the filler leaves just enough leftover room for the heading alone, not enough for
  // the heading + body together -- exactly the scenario that used to split the group.
  const filler = 'x'.repeat(1200)
  const textBlocks = [
    { id: 'p1', text: filler, group_id: 0, role: 'body' },
    { id: 'p2', text: '작은 제목', group_id: 1, role: 'section_label' },
    {
      id: 'p3', text: '이 문단은 제목 바로 다음에 오는 본문입니다. 그룹으로 묶여있어야 합니다.', group_id: 1, role: 'body',
    },
  ]
  const result = paginateGridPlan(plan, '', textBlocks)
  const pageContaining = (needle) => result.findIndex((p) => Object.values(p.textSlicesByElementId).some((s) => s === needle))
  const headingPage = pageContaining('작은 제목')
  const bodyPage = pageContaining('이 문단은 제목 바로 다음에 오는 본문입니다. 그룹으로 묶여있어야 합니다.')
  assert.ok(headingPage >= 0 && bodyPage >= 0, 'both blocks must be placed somewhere')
  assert.equal(headingPage, bodyPage, 'the heading and its group-mate body must land on the same page')
})
test('planned text elements render with the source markdown role, not the LLM-guessed role', () => {
  const plan = { pages: [{ page: 1, elements: [{ id: 'p1_wrong', type: 'text', role: 'section_label', text_source: 'paragraph_1', col_start: 1, col_span: 6, row_start: 1, row_span: 4 }] }] }
  const textBlocks = [{ id: 'p1', text: '건강기능식품 브랜드 Feel Menopause는 패키지 디자인에 대담한 핑크색을 사용합니다.', role: 'body', group_id: 0 }]
  const result = paginateGridPlan(plan, '', textBlocks)
  assert.equal(result[0].elements[0].role, 'body')
})

test('overflow pages use compact spacing inside a no-blank-line markdown group', () => {
  const plan = { pages: [{ page: 1, elements: [] }] }
  const textBlocks = [
    { id: 'p1', text: '맥락에 맞는 컬러', role: 'section_label', group_id: 0 },
    { id: 'p2', text: 'CONTEXT RELEVANT COLOR', role: 'section_label', group_id: 0 },
    { id: 'p3', text: '건강기능식품 브랜드 Feel Menopause는 패키지 디자인에 대담한 핑크색을 사용하여 여성들에게 자신감과 힘을 부여하는 이미지를 전달합니다.', role: 'body', group_id: 0 },
    { id: 'p4', text: '힘을 주는 레터링', role: 'section_label', group_id: 1 },
  ]
  const result = paginateGridPlan(plan, '', textBlocks)
  const overflowPage = result.find((p) => p.elements.length >= 4)
  assert.ok(overflowPage, 'all short overflow blocks should fit on one compact page')
  const [ko, en, body, nextKo] = overflowPage.elements
  const sameGroupGap = en.box_mm.yMm - (ko.box_mm.yMm + ko.box_mm.hMm)
  const bodyGap = body.box_mm.yMm - (en.box_mm.yMm + en.box_mm.hMm)
  const newGroupGap = nextKo.box_mm.yMm - (body.box_mm.yMm + body.box_mm.hMm)
  assert.ok(sameGroupGap <= 2.1, `same group heading gap should be compact, got ${sameGroupGap}`)
  assert.ok(bodyGap <= 2.1, `same group body gap should be compact, got ${bodyGap}`)
  assert.ok(newGroupGap >= 4.9, `blank-line/new-group gap should be visibly larger, got ${newGroupGap}`)
})

test('repeated text_source boxes consume one paragraph sequentially instead of restarting it', () => {
  const paragraph = '아디다스가 역대 최대 규모로 진행한 여성 축구화 착용 연구를 바탕으로 개발한 F50 SPARKFUSION은 여성의 신체 구조와 움직임을 고려한 디자인과 소재를 적용한 제품입니다.'
  const plan = {
    pages: [{
      page: 1,
      elements: [
        { id: 'chunk_1', type: 'text', role: 'body', text_source: 'paragraph_1', col_start: 1, col_span: 3, row_start: 1, row_span: 1 },
        { id: 'chunk_2', type: 'text', role: 'body', text_source: 'paragraph_1', col_start: 4, col_span: 3, row_start: 1, row_span: 1 },
      ],
    }],
  }
  const result = paginateGridPlan(plan, '', [{ id: 'p1', text: paragraph, role: 'body', group_id: 0 }])
  const first = result[0].textSlicesByElementId.chunk_1
  const second = result[0].textSlicesByElementId.chunk_2
  assert.ok(first.length > 0)
  assert.ok(second.length > 0)
  assert.notEqual(second, first, 'the second box should continue the paragraph, not repeat the first slice')
  assert.equal(paragraph.startsWith(`${first} ${second}`) || paragraph.startsWith(first + second), true)
})



test('leftover overflow keeps source order instead of grouping all headings before body tails', () => {
  const plan = {
    pages: [{
      page: 1,
      elements: [
        { id: 'body_first', type: 'text', role: 'body', text_source: 'paragraph_3', col_start: 1, col_span: 6, row_start: 1, row_span: 1 },
      ],
    }],
  }
  const textBlocks = [
    { id: 'p1', text: 'FIRST HEADING', role: 'section_label', group_id: 0 },
    { id: 'p2', text: 'First body stays with its heading.', role: 'body', group_id: 0 },
    { id: 'p3', text: 'Second body has a planned fragment and the remaining overflow tail. '.repeat(20), role: 'body', group_id: 1 },
    { id: 'p4', text: 'NEXT HEADING', role: 'section_label', group_id: 2 },
  ]
  const result = paginateGridPlan(plan, '', textBlocks)
  const overflowSlices = result.slice(1).flatMap((page) => Object.values(page.textSlicesByElementId).filter(Boolean))
  const firstHeadingIndex = overflowSlices.findIndex((s) => s.includes('FIRST HEADING'))
  const firstBodyIndex = overflowSlices.findIndex((s) => s.includes('First body stays'))
  const secondTailIndex = overflowSlices.findIndex((s) => s.includes('remaining overflow tail'))
  const nextHeadingIndex = overflowSlices.findIndex((s) => s.includes('NEXT HEADING'))

  assert.ok(firstHeadingIndex >= 0 && firstBodyIndex > firstHeadingIndex, 'first body should stay after its heading')
  assert.ok(secondTailIndex > firstBodyIndex, 'referenced paragraph tail should remain in source order')
  assert.ok(nextHeadingIndex > secondTailIndex, 'later heading should not jump ahead of body tail')
})

test('heading text_source is not truncated into overflow just because its estimated box is tight', () => {
  const plan = { pages: [{ page: 1, elements: [{ id: 'heading', type: 'text', role: 'section_label', text_source: 'paragraph_1', col_start: 1, col_span: 6, row_start: 1, row_span: 1 }] }] }
  const textBlocks = [{ id: 'p1', text: 'CONSUMER SPECIFIC DESIGN', role: 'section_label', group_id: 0 }]
  const result = paginateGridPlan(plan, '', textBlocks)
  assert.equal(result[0].textSlicesByElementId.heading, 'CONSUMER SPECIFIC DESIGN')
  assert.equal(result.length, 1, 'a heading must not create a continuation page for one missing word')
})