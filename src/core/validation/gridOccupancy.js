// Pure integer grid-cell occupancy: a 2D boolean-ish grid (columns x rows) where each cell can be
// claimed by at most one element. This is deliberately simpler than mm/gap-based collision math --
// no floating point, no gap-margin ambiguity -- because a page laid out on an integer grid cannot
// have two elements overlap unless they claim the same cell, which is a trivial set check. The
// grid's own gutter (GRID_GUTTER_MM, >= every required text/image/text-text min gap) means "no two
// elements share a cell" automatically satisfies the mm gap requirements too.
export function createOccupancyGrid(columns, rows) {
  return Array.from({ length: rows }, () => Array.from({ length: columns }, () => null))
}

function cellsFor(colStart, colSpan, rowStart, rowSpan) {
  const cells = []
  for (let r = rowStart; r < rowStart + rowSpan; r += 1) {
    for (let c = colStart; c < colStart + colSpan; c += 1) {
      cells.push([r, c])
    }
  }
  return cells
}

// True only if every cell in the requested rectangle is within grid bounds AND unclaimed.
export function isFree(grid, colStart, colSpan, rowStart, rowSpan) {
  const rows = grid.length
  const columns = grid[0]?.length ?? 0
  if (colStart < 1 || rowStart < 1) return false
  if (colStart + colSpan - 1 > columns) return false
  if (rowStart + rowSpan - 1 > rows) return false
  return cellsFor(colStart, colSpan, rowStart, rowSpan).every(([r, c]) => grid[r - 1][c - 1] == null)
}

// Claims every cell in the rectangle for `id`. Caller must have already checked isFree.
export function occupy(grid, colStart, colSpan, rowStart, rowSpan, id) {
  cellsFor(colStart, colSpan, rowStart, rowSpan).forEach(([r, c]) => {
    grid[r - 1][c - 1] = id
  })
}

// Finds the free rectangle of the given size closest to the requested (preferredCol, preferredRow),
// searching row-by-row from the top of the grid outward from the preferred row. Returns
// {colStart, rowStart} or null if no free rectangle of this size exists anywhere on the page.
export function findNearestFreeSlot(grid, colSpan, rowSpan, preferredCol, preferredRow) {
  const rows = grid.length
  const columns = grid[0]?.length ?? 0
  if (colSpan > columns || rowSpan > rows) return null

  let best = null
  let bestDistance = Infinity
  for (let rowStart = 1; rowStart <= rows - rowSpan + 1; rowStart += 1) {
    for (let colStart = 1; colStart <= columns - colSpan + 1; colStart += 1) {
      if (!isFree(grid, colStart, colSpan, rowStart, rowSpan)) continue
      const distance = Math.abs(rowStart - preferredRow) * columns + Math.abs(colStart - preferredCol)
      if (distance < bestDistance) {
        bestDistance = distance
        best = { colStart, rowStart }
        if (distance === 0) return best // exact match at the requested position -- can't do better
      }
    }
  }
  return best
}
