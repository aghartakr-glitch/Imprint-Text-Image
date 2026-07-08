import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildOccupiedCellSet, isCellFree, freeRowSegmentsForColumn, expandFlowRegionToSlots,
} from './ReservedRegionManager.js'

test('buildOccupiedCellSet marks every cell a reserved region covers, on the right page', () => {
  const occupied = buildOccupiedCellSet([{
    page: 1, col_start: 3, col_span: 2, row_start: 1, row_span: 5,
  }])
  assert.equal(isCellFree(occupied, 1, 3, 1), false)
  assert.equal(isCellFree(occupied, 1, 4, 5), false)
  assert.equal(isCellFree(occupied, 1, 3, 6), true)
  assert.equal(isCellFree(occupied, 2, 3, 1), true, 'a different page is unaffected')
})

test('matches the spec\'s worked example exactly: image at col 3-4 row 1-5 leaves col 3-4 row 6-12 free', () => {
  const occupied = buildOccupiedCellSet([{
    page: 1, col_start: 3, col_span: 2, row_start: 1, row_span: 5,
  }])
  const col1 = freeRowSegmentsForColumn(occupied, {
    page: 1, col: 1, rowStart: 1, rowSpan: 12,
  })
  const col3 = freeRowSegmentsForColumn(occupied, {
    page: 1, col: 3, rowStart: 1, rowSpan: 12,
  })
  assert.deepEqual(col1, [{ row_start: 1, row_span: 12 }], 'col 1 (unblocked) is free the whole height')
  assert.deepEqual(col3, [{ row_start: 6, row_span: 7 }], 'col 3 is free only from row 6 onward')
})

test('a reserved region in the middle of a column splits it into two free segments', () => {
  const occupied = buildOccupiedCellSet([{
    page: 1, col_start: 1, col_span: 1, row_start: 5, row_span: 3,
  }])
  const segments = freeRowSegmentsForColumn(occupied, {
    page: 1, col: 1, rowStart: 1, rowSpan: 12,
  })
  assert.deepEqual(segments, [
    { row_start: 1, row_span: 4 },
    { row_start: 8, row_span: 5 },
  ])
})

test('expandFlowRegionToSlots produces one slot per free segment, in column order', () => {
  const reservedRegions = [{
    page: 1, col_start: 1, col_span: 4, row_start: 1, row_span: 7,
  }]
  const flowRegion = {
    page: 1, col_start: 1, col_span: 4, row_start: 1, row_span: 12,
  }
  const slots = expandFlowRegionToSlots(flowRegion, reservedRegions)
  // every column's rows 1-7 are blocked by the image, so each column contributes exactly one
  // free slot covering rows 8-12
  assert.equal(slots.length, 4)
  slots.forEach((slot, i) => {
    assert.equal(slot.col_start, i + 1)
    assert.deepEqual({ row_start: slot.row_start, row_span: slot.row_span }, { row_start: 8, row_span: 5 })
  })
})

test('expandFlowRegionToSlots with no reserved regions returns one full-height slot per column', () => {
  const flowRegion = {
    page: 1, col_start: 1, col_span: 2, row_start: 1, row_span: 12,
  }
  const slots = expandFlowRegionToSlots(flowRegion, [])
  assert.equal(slots.length, 2)
  assert.deepEqual(slots.map((s) => s.row_span), [12, 12])
})
