import { test } from 'node:test'
import assert from 'node:assert/strict'
import { textDensityFromLength } from './textDensity.js'

test('0~1200자는 short', () => {
  assert.equal(textDensityFromLength(0), 'short')
  assert.equal(textDensityFromLength(1200), 'short')
})

test('1201~3500자는 medium', () => {
  assert.equal(textDensityFromLength(1201), 'medium')
  assert.equal(textDensityFromLength(3500), 'medium')
})

test('3501자 이상은 long', () => {
  assert.equal(textDensityFromLength(3501), 'long')
  assert.equal(textDensityFromLength(50000), 'long')
})
