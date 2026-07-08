import { test } from 'node:test'
import assert from 'node:assert/strict'
import { retrieveLayoutReferences } from './retrieveLayoutReferences.js'

test('returns at most topN results, capped and non-empty for a common input shape', () => {
  const results = retrieveLayoutReferences({
    imageCount: 2, textDensity: 'short', outputUnit: 'single_page', imageOrientations: ['landscape', 'portrait'],
  }, { topN: 5 })
  assert.ok(results.length > 0 && results.length <= 5)
  results.forEach((r) => {
    assert.ok('pattern_id' in r && 'layout_family' in r && 'quality_score' in r)
  })
})

test('prefers rows whose image_count exactly matches the input', () => {
  const results = retrieveLayoutReferences({ imageCount: 2, textDensity: 'short' }, { topN: 5 })
  const exactMatches = results.filter((r) => r.image_count === 2).length
  assert.ok(exactMatches >= 1, 'expected at least one exact image_count match near the top of the ranking')
})

test('never returns more than topN even when far more rows exist', () => {
  const results = retrieveLayoutReferences({ imageCount: 3, textDensity: 'medium' }, { topN: 3 })
  assert.ok(results.length <= 3)
})
