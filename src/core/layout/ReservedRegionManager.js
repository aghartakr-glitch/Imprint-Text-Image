// Spec section 5.4/7.2: images (or any other occupied element) are "reserved regions" that text
// flow must route around instead of overlapping. Grid cells are addressed as (page, col, row).
export function buildOccupiedCellSet(reservedRegions) {
  const occupied = new Set()
  reservedRegions.forEach((region) => {
    const page = region.page ?? 1
    for (let c = region.col_start; c < region.col_start + region.col_span; c += 1) {
      for (let r = region.row_start; r < region.row_start + region.row_span; r += 1) {
        occupied.add(`${page}:${c}:${r}`)
      }
    }
  })
  return occupied
}

export function isCellFree(occupiedSet, page, col, row) {
  return !occupiedSet.has(`${page}:${col}:${row}`)
}

// For one column on one page, within [rowStart, rowStart+rowSpan-1], returns the contiguous
// free row-range segments not blocked by any reserved region. Example from the spec: an image at
// col 3-4 row 1-5 leaves col 3 (and col 4) with a single free segment { row_start: 6, row_span: 7 }
// when asked over the full row_start=1/row_span=12 range.
export function freeRowSegmentsForColumn(occupiedSet, {
  page, col, rowStart, rowSpan,
}) {
  const segments = []
  let segmentStart = null
  const lastRow = rowStart + rowSpan - 1
  for (let row = rowStart; row <= lastRow; row += 1) {
    const free = isCellFree(occupiedSet, page, col, row)
    if (free && segmentStart == null) segmentStart = row
    if (!free && segmentStart != null) {
      segments.push({ row_start: segmentStart, row_span: row - segmentStart })
      segmentStart = null
    }
  }
  if (segmentStart != null) segments.push({ row_start: segmentStart, row_span: lastRow - segmentStart + 1 })
  return segments
}

// A flow_region spans multiple columns; this expands it into an ordered list of per-column free
// slots (skipping any rows blocked by reserved regions), in column order -- exactly what
// ColumnFlowEngine.js consumes to know where it may place text, one column at a time.
export function expandFlowRegionToSlots(flowRegion, reservedRegions) {
  const occupied = buildOccupiedCellSet(reservedRegions)
  const page = flowRegion.page ?? 1
  const slots = []
  for (let col = flowRegion.col_start; col < flowRegion.col_start + flowRegion.col_span; col += 1) {
    const segments = freeRowSegmentsForColumn(occupied, {
      page, col, rowStart: flowRegion.row_start, rowSpan: flowRegion.row_span,
    })
    segments.forEach((seg) => {
      slots.push({
        page, col_start: col, col_span: 1, row_start: seg.row_start, row_span: seg.row_span,
      })
    })
  }
  return slots
}
