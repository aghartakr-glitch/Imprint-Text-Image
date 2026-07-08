export const PAGE_WIDTH_MM = 148
export const PAGE_HEIGHT_MM = 210

export const MARGIN_TOP_MM = 16
export const MARGIN_BOTTOM_MM = 18
export const MARGIN_INNER_MM = 18
export const MARGIN_OUTER_MM = 14

export const TEXT_BOX_WIDTH_MM = PAGE_WIDTH_MM - MARGIN_INNER_MM - MARGIN_OUTER_MM
export const TEXT_BOX_HEIGHT_MM = PAGE_HEIGHT_MM - MARGIN_TOP_MM - MARGIN_BOTTOM_MM

export const BODY_FONT_SIZE_PT = 9
export const BODY_LEADING_PT = 14
export const PT_TO_MM = 0.3528

export const CHAR_WIDTH_MM = BODY_FONT_SIZE_PT * PT_TO_MM
export const LINE_HEIGHT_MM = BODY_LEADING_PT * PT_TO_MM

export const IMAGE_TEXT_GAP_MM = 6

// Grid-based layout_plan system (v0.3): the LLM places elements on this grid instead of
// inventing mm coordinates directly. The grid spans the full physical page (not just the
// margin-constrained text box) so that full-bleed compositions (e.g. single_full_page) stay
// expressible; nothing in the fixed-constraint checklist requires text to avoid the margins.
export const GRID_COLUMNS = 6
export const GRID_ROWS = 12
export const GRID_GUTTER_MM = 4

// Section-opener title page (used only when the user supplies a title).
export const TITLE_FONT_SIZE_PT = 28
export const TITLE_LEADING_PT = 34
export const TITLE_VERTICAL_POSITION_RATIO = 0.4 // title baseline sits 40% down the text box, not dead-center
