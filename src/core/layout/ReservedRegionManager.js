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

// A flow_region spans multiple columns; this expands it into an ordered list of free rectangular
// slots (skipping any rows blocked by reserved regions).
//
// CRITICAL: a slot is the WIDEST contiguous run of free columns available for a given row-range,
// not one slot per individual column. A previous version emitted exactly one 1-column-wide slot
// per grid column regardless of how wide the flow_region actually was -- so a 2-column-wide band
// intended to read as a single readable paragraph column got shredded into two narrow slivers, and
// a 4-column page-wide region became four separate narrow columns (the "rigid 4-column text wall"
// the user reported, screenshots showing single sentences broken into 4 vertical strips). Grid
// columns are an alignment/positioning unit, not a mandate that every text block must be exactly
// one column wide -- editorial text blocks should span as many columns as are actually free.
export function expandFlowRegionToSlots(flowRegion, reservedRegions) {
  const occupied = buildOccupiedCellSet(reservedRegions)
  const page = flowRegion.page ?? 1
  const colStart = flowRegion.col_start
  const colEnd = flowRegion.col_start + flowRegion.col_span - 1
  const rowStart = flowRegion.row_start
  const rowEnd = flowRegion.row_start + flowRegion.row_span - 1

  // Per row, compute the free/occupied bit for every column, so we can find row-ranges that share
  // an identical free-column pattern (an image obstruction is itself rectangular, so its free
  // pattern is constant across its own row span and changes only at its top/bottom edge).
  const rowPatterns = []
  for (let row = rowStart; row <= rowEnd; row += 1) {
    const pattern = []
    for (let col = colStart; col <= colEnd; col += 1) pattern.push(isCellFree(occupied, page, col, row))
    rowPatterns.push({ row, pattern })
  }

  const slots = []
  let segStart = 0
  for (let i = 1; i <= rowPatterns.length; i += 1) {
    const changed = i === rowPatterns.length || !patternsEqual(rowPatterns[i].pattern, rowPatterns[segStart].pattern)
    if (!changed) continue // eslint-disable-line no-continue
    const segRowStart = rowPatterns[segStart].row
    const segRowSpan = rowPatterns[i - 1].row - segRowStart + 1
    // Within this row-range's shared pattern, merge contiguous free columns into maximal-width runs.
    const pattern = rowPatterns[segStart].pattern
    let runStart = null
    for (let c = 0; c <= pattern.length; c += 1) {
      const free = c < pattern.length && pattern[c]
      if (free && runStart == null) runStart = c
      if (!free && runStart != null) {
        slots.push({
          page, col_start: colStart + runStart, col_span: c - runStart, row_start: segRowStart, row_span: segRowSpan,
        })
        runStart = null
      }
    }
    segStart = i
  }
  return slots
}

function patternsEqual(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i])
}
