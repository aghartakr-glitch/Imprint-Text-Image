import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estimateTextCapacityMm, estimateTextCapacity } from './estimateTextCapacity.js'

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
