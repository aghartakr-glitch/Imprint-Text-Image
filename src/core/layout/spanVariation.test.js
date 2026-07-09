import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeSpanVariation } from './spanVariation.js'

function planWithTextSpans(spans, columns = 4) {
  return {
    grid_spec: { columns, rows: 12 },
    grid: { columns, rows: 12 },
    pages: [{
      page: 1,
      elements: spans.map((s, i) => ({
        id: `t${i}`, type: 'text', col_span: s, col_start: 1, row_start: 1, row_span: 2,
      })),
    }],
  }
}

test('all body text at uniform 2-column is NOT flagged as forcedRigidColumns (legitimate reading layout)', () => {
  const result = analyzeSpanVariation(planWithTextSpans([2, 2, 2]))
  assert.equal(result.forcedRigidColumns, false)
  assert.equal(result.noTextSpanVariationWarning, true)
})

test('all body text at 1-column on a 3+ column grid IS flagged as forcedRigidColumns', () => {
  const result = analyzeSpanVariation(planWithTextSpans([1, 1, 1]))
  assert.equal(result.forcedRigidColumns, true)
})

test('mixed spans have variation used and no warning', () => {
  const result = analyzeSpanVariation(planWithTextSpans([2, 3, 1]))
  assert.equal(result.forcedRigidColumns, false)
  assert.equal(result.text_span_variation_used, true)
  assert.equal(result.noTextSpanVariationWarning, false)
})
