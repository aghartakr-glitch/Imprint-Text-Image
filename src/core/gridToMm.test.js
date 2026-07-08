import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gridToMm } from './gridToMm.js'
import { TEXT_BOX_WIDTH_MM, TEXT_BOX_HEIGHT_MM } from './layoutConstants.js'

test('a full 6x12 span covers exactly the margin-constrained text box (edge-to-edge within it)', () => {
  const box = gridToMm({
    col_start: 1, col_span: 6, row_start: 1, row_span: 12,
  })
  assert.equal(box.xMm, 0)
  assert.equal(box.yMm, 0)
  assert.ok(Math.abs(box.wMm - TEXT_BOX_WIDTH_MM) < 1e-9)
  assert.ok(Math.abs(box.hMm - TEXT_BOX_HEIGHT_MM) < 1e-9)
})

test('col_start=4,col_span=3 sits in the right half with a gutter before it', () => {
  const left = gridToMm({
    col_start: 1, col_span: 3, row_start: 1, row_span: 5,
  })
  const right = gridToMm({
    col_start: 4, col_span: 3, row_start: 1, row_span: 5,
  })
  assert.ok(right.xMm > left.xMm + left.wMm, 'right box should start after a gutter past the left box')
  assert.ok(Math.abs((right.xMm + right.wMm) - TEXT_BOX_WIDTH_MM) < 1e-9, 'right box should reach the text box edge')
})

test('two vertically stacked spans leave a gutter between them and never overlap', () => {
  const top = gridToMm({
    col_start: 1, col_span: 6, row_start: 1, row_span: 6,
  })
  const bottom = gridToMm({
    col_start: 1, col_span: 6, row_start: 7, row_span: 6,
  })
  assert.ok(bottom.yMm > top.yMm + top.hMm)
  assert.ok(Math.abs((bottom.yMm + bottom.hMm) - TEXT_BOX_HEIGHT_MM) < 1e-9)
})

test('a single 1x1 cell is small and positioned correctly', () => {
  const box = gridToMm({
    col_start: 6, col_span: 1, row_start: 12, row_span: 1,
  })
  assert.ok(box.wMm > 0 && box.wMm < TEXT_BOX_WIDTH_MM / 5)
  assert.ok(Math.abs((box.xMm + box.wMm) - TEXT_BOX_WIDTH_MM) < 1e-9)
  assert.ok(Math.abs((box.yMm + box.hMm) - TEXT_BOX_HEIGHT_MM) < 1e-9)
})
