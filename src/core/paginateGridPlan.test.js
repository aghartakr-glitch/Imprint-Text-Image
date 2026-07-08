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
