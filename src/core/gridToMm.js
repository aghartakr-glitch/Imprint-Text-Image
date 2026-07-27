import {
  TEXT_BOX_WIDTH_MM, TEXT_BOX_HEIGHT_MM, GRID_COLUMNS, GRID_ROWS, GRID_GUTTER_MM,
  PAGE_WIDTH_MM, PAGE_HEIGHT_MM,
} from './layoutConstants.js'

// Converts one layout_plan element's grid placement (1-based col_start/row_start, col_span/
// row_span) into an mm box *relative to the margin-constrained text box*, not the raw physical
// page. This keeps every grid-placed element (image or text) safely inside the fixed margins --
// consistent with "margins must not change" -- and lets the existing recto/verso margin-offset
// placement code in buildLatex.js keep working unchanged for grid-plan pages. A full 6x12 span
// fills the entire available page area up to the margins, not the literal physical edge.
export function gridToMm(element, {
  boxWidthMm = TEXT_BOX_WIDTH_MM, boxHeightMm = TEXT_BOX_HEIGHT_MM,
  columns = GRID_COLUMNS, rows = GRID_ROWS, gutterMm = GRID_GUTTER_MM,
} = {}) {
  const colWidthMm = (boxWidthMm - gutterMm * (columns - 1)) / columns
  const rowHeightMm = (boxHeightMm - gutterMm * (rows - 1)) / rows

  const xMm = (element.col_start - 1) * (colWidthMm + gutterMm)
  const yMm = (element.row_start - 1) * (rowHeightMm + gutterMm)
  const wMm = element.col_span * colWidthMm + (element.col_span - 1) * gutterMm
  const hMm = element.row_span * rowHeightMm + (element.row_span - 1) * gutterMm

  return { xMm, yMm, wMm, hMm }
}

// Full-bleed box: ignores col/row placement entirely and spans the literal physical page edge to
// edge, not just the margin-constrained text box. Paired with buildLatex.js's `image.fullBleed`
// branch, which places these xMm/yMm as absolute physical-page coordinates instead of adding the
// margin offset it uses for every other (grid-placed) element.
export function gridToMmFullBleed() {
  return {
    xMm: 0, yMm: 0, wMm: PAGE_WIDTH_MM, hMm: PAGE_HEIGHT_MM,
  }
}
