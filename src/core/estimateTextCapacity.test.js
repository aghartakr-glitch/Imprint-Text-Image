import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estimateTextCapacityMm, estimateTextCapacity, validateLayoutTextCapacity } from './estimateTextCapacity.js'

test('a zero-size box has zero capacity', () => {
  assert.equal(estimateTextCapacityMm(0, 0), 0)
})

test('capacity grows with box width and height', () => {
  const small = estimateTextCapacityMm(30, 30)
  const large = estimateTextCapacityMm(100, 100)
  assert.ok(large > small)
})

test('estimateTextCapacity converts a grid element to mm first', () => {
  const capacity = estimateTextCapacity({
    col_start: 1, col_span: 6, row_start: 1, row_span: 12,
  })
  assert.ok(capacity > 0)
})

// Regression: the pages.forEach callback destructured (pageIdx, page) instead of (page, pageIdx),
// so `page.textBlocks` was always read off a numeric index and validateLayoutTextCapacity silently
// returned zero issues for every plan, ever -- a paragraph far too long for its box would overflow
// unnoticed and visually bleed into whatever sat below it (confirmed 2026-07-10: text bleeding into
// an image in a real generated PDF).
test('flags a text_source element whose referenced paragraph overflows its box', () => {
  const plan = {
    grid_spec: {
      columns: 4, rows: 12, gutter_mm: 4,
    },
    pages: [{
      page: 1,
      elements: [
        {
          id: 'p1_body', type: 'text', role: 'body', text_source: 'paragraph_1', col_start: 1, col_span: 1, row_start: 1, row_span: 1,
        },
      ],
    }],
  }
  const textBlocks = [{ id: 'p1', text: 'x'.repeat(2000), char_count: 2000 }]

  const issues = validateLayoutTextCapacity(plan, textBlocks)
  assert.equal(issues.length, 1)
  assert.equal(issues[0].elementId, 'p1_body')
  assert.equal(issues[0].page, 1)
})

test('does not flag a text_source element that fits comfortably within its box', () => {
  const plan = {
    grid_spec: {
      columns: 4, rows: 12, gutter_mm: 4,
    },
    pages: [{
      page: 1,
      elements: [
        {
          id: 'p1_body', type: 'text', role: 'body', text_source: 'paragraph_1', col_start: 1, col_span: 4, row_start: 1, row_span: 12,
        },
      ],
    }],
  }
  const textBlocks = [{ id: 'p1', text: 'short paragraph', char_count: 15 }]

  const issues = validateLayoutTextCapacity(plan, textBlocks)
  assert.deepEqual(issues, [])
})
