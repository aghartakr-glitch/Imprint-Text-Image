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
