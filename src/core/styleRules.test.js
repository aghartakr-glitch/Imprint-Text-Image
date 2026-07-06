import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inferStyleByRules } from './styleRules.js'

test('few images + long text -> Editorial', () => {
  const result = inferStyleByRules({ imageCount: 1, textLength: 3000 })
  assert.equal(result.style, 'Editorial')
})

test('many images -> Magazine', () => {
  const result = inferStyleByRules({ imageCount: 5, textLength: 500 })
  assert.equal(result.style, 'Magazine')
})

test('moderate images + short text -> Exhibition Catalog', () => {
  const result = inferStyleByRules({ imageCount: 3, textLength: 400 })
  assert.equal(result.style, 'Exhibition Catalog')
})
