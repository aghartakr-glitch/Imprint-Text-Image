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

test('expandFlowRegionToSlots merges the free row-range into ONE wide slot spanning every free column, not one slot per column', () => {
  // Grid columns are an alignment unit, not a mandate that text be sliced into 1-column slivers:
  // when all 4 columns share the same free/occupied pattern for a row-range, that range must
  // become a single 4-column-wide slot (a real editorial-width paragraph column), not four
  // separate 1-column-wide slots side by side (the "rigid 4-column text wall" bug this replaces).
  const reservedRegions = [{
    page: 1, col_start: 1, col_span: 4, row_start: 1, row_span: 7,
  }]
  const flowRegion = {
    page: 1, col_start: 1, col_span: 4, row_start: 1, row_span: 12,
  }
  const slots = expandFlowRegionToSlots(flowRegion, reservedRegions)
  assert.equal(slots.length, 1)
  assert.deepEqual(slots[0], {
    page: 1, col_start: 1, col_span: 4, row_start: 8, row_span: 5,
  })
})

test('expandFlowRegionToSlots with no reserved regions returns one full-width slot, not one per column', () => {
  const flowRegion = {
    page: 1, col_start: 1, col_span: 2, row_start: 1, row_span: 12,
  }
  const slots = expandFlowRegionToSlots(flowRegion, [])
  assert.equal(slots.length, 1)
  assert.deepEqual(slots[0], {
    page: 1, col_start: 1, col_span: 2, row_start: 1, row_span: 12,
  })
})

test('a reserved region blocking only some columns leaves the unblocked columns as one merged wide slot beside it', () => {
  // Image occupies col 3-4 rows 1-5; col 1-2 are free the whole height -> ONE 2-column-wide slot,
  // not two separate 1-column slots.
  const reservedRegions = [{
    page: 1, col_start: 3, col_span: 2, row_start: 1, row_span: 5,
  }]
  const flowRegion = {
    page: 1, col_start: 1, col_span: 4, row_start: 1, row_span: 12,
  }
  const slots = expandFlowRegionToSlots(flowRegion, reservedRegions)
  // rows 1-5: col 1-2 free (one 2-wide slot); rows 6-12: col 1-4 all free (one 4-wide slot)
  assert.equal(slots.length, 2)
  assert.deepEqual(slots[0], {
    page: 1, col_start: 1, col_span: 2, row_start: 1, row_span: 5,
  })
  assert.deepEqual(slots[1], {
    page: 1, col_start: 1, col_span: 4, row_start: 6, row_span: 7,
  })
})
