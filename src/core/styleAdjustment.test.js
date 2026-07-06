import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scaleImageHeight } from './styleAdjustment.js'

test('Editorial shrinks images, Exhibition Catalog enlarges them', () => {
  assert.equal(scaleImageHeight(100, 'Editorial'), 85)
  assert.equal(scaleImageHeight(100, 'Magazine'), 100)
  assert.equal(scaleImageHeight(100, 'Exhibition Catalog'), 115)
})

test('unknown style falls back to scale 1.0', () => {
  assert.equal(scaleImageHeight(100, 'Unknown'), 100)
})
