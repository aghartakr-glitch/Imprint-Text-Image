import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compactOversizedTextSpans } from './compactOversizedTextSpans.js'

// Regression fixture matching the exact real report: a 9-character heading given a 70mm-tall
// (row_span=6 of 12) box, followed by another short element stacked far below it in the same
// column, leaving a huge dead gap between two elements meant to read as one tight group.
test('shrinks an oversized heading box and pulls the element below it up to close the gap', () => {
  const plan = {
    grid_spec: { columns: 2, rows: 12, gutter_mm: 4 },
    pages: [{
      page: 1,
      elements: [
        {
          id: 'heading_1', type: 'text', role: 'body', text_source: 'paragraph_1', col_start: 2, col_span: 1, row_start: 1, row_span: 6,
        },
        {
          id: 'body_1', type: 'text', role: 'body', text_source: 'paragraph_2', col_start: 2, col_span: 1, row_start: 7, row_span: 6,
        },
      ],
    }],
  }
  const textBlocks = [
    { id: 'p1', text: '커뮤니티 액티비즘', char_count: 9 },
    { id: 'p2', text: '스웨티 베티는 스포츠 액티비스트 리파 네사', char_count: 20 },
  ]

  const { plan: repaired, repaired: didRepair, actions } = compactOversizedTextSpans(plan, textBlocks)
  assert.equal(didRepair, true)
  assert.equal(actions.length, 2)

  const [heading, body] = repaired.pages[0].elements
  assert.ok(heading.row_span < 6, 'the oversized heading box should shrink')
  assert.equal(heading.row_start, 1, 'the first element in a column keeps its original start')
  assert.equal(body.row_start, heading.row_start + heading.row_span, 'the next element should be pulled up flush against the shrunk heading, not left at its old row_start')
  assert.ok(body.row_span < 6, 'the oversized body box should also shrink')
})

test('does not touch a box that already fits its content tightly', () => {
  const plan = {
    grid_spec: { columns: 2, rows: 12, gutter_mm: 4 },
    pages: [{
      page: 1,
      elements: [
        {
          id: 'body_1', type: 'text', role: 'body', text_source: 'paragraph_1', col_start: 1, col_span: 2, row_start: 1, row_span: 12,
        },
      ],
    }],
  }
  // A long paragraph that genuinely needs the full 12-row box -- nothing should shrink.
  const textBlocks = [{ id: 'p1', text: 'x'.repeat(2000), char_count: 2000 }]

  const { repaired: didRepair, actions } = compactOversizedTextSpans(plan, textBlocks)
  assert.equal(didRepair, false)
  assert.equal(actions.length, 0)
})

test('leaves images untouched and does not use them to close text gaps', () => {
  const plan = {
    grid_spec: { columns: 2, rows: 12, gutter_mm: 4 },
    pages: [{
      page: 1,
      elements: [
        {
          id: 'heading_1', type: 'text', role: 'body', text_source: 'paragraph_1', col_start: 2, col_span: 1, row_start: 1, row_span: 6,
        },
        {
          id: 'image_1', type: 'image', role: 'support', col_start: 1, col_span: 1, row_start: 3, row_span: 5,
        },
      ],
    }],
  }
  const textBlocks = [{ id: 'p1', text: '짧은 제목', char_count: 5 }]

  const { plan: repaired } = compactOversizedTextSpans(plan, textBlocks)
  const image = repaired.pages[0].elements.find((el) => el.id === 'image_1')
  assert.deepEqual(image, plan.pages[0].elements[1], 'image element must be completely unchanged')
})

// Two independent columns (different col_start) must not interfere with each other's compaction.
test('compacts each column group independently', () => {
  const plan = {
    grid_spec: { columns: 2, rows: 12, gutter_mm: 4 },
    pages: [{
      page: 1,
      elements: [
        {
          id: 'col1_a', type: 'text', role: 'body', text_source: 'paragraph_1', col_start: 1, col_span: 1, row_start: 1, row_span: 8,
        },
        {
          id: 'col2_a', type: 'text', role: 'body', text_source: 'paragraph_2', col_start: 2, col_span: 1, row_start: 1, row_span: 3,
        },
        {
          id: 'col2_b', type: 'text', role: 'body', text_source: 'paragraph_3', col_start: 2, col_span: 1, row_start: 4, row_span: 8,
        },
      ],
    }],
  }
  const textBlocks = [
    { id: 'p1', text: '짧다', char_count: 2 },
    { id: 'p2', text: '짧다2', char_count: 3 },
    { id: 'p3', text: '짧다3', char_count: 3 },
  ]

  const { plan: repaired } = compactOversizedTextSpans(plan, textBlocks)
  const byId = Object.fromEntries(repaired.pages[0].elements.map((el) => [el.id, el]))
  // col2_b should be pulled up flush against col2_a within its own column, independent of col1_a.
  assert.equal(byId.col2_b.row_start, byId.col2_a.row_start + byId.col2_a.row_span)
})
