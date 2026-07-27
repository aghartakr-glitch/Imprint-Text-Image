export const PAGE_WIDTH_MM = 148
export const PAGE_HEIGHT_MM = 210

export const MARGIN_TOP_MM = 16
// Equal to MARGIN_TOP_MM (was 18mm) -- now that the page number/running head live at the top of
// the page (not the bottom footer they used to occupy), an unequal bottom margin just reads as
// extra dead whitespace at the bottom with nothing using it, not a deliberate design choice.
export const MARGIN_BOTTOM_MM = 16
export const MARGIN_INNER_MM = 18
export const MARGIN_OUTER_MM = 14

export const TEXT_BOX_WIDTH_MM = PAGE_WIDTH_MM - MARGIN_INNER_MM - MARGIN_OUTER_MM
export const TEXT_BOX_HEIGHT_MM = PAGE_HEIGHT_MM - MARGIN_TOP_MM - MARGIN_BOTTOM_MM

export const BODY_FONT_SIZE_PT = 9
export const BODY_LEADING_PT = 14
export const PT_TO_MM = 0.3528

// Calibration factor: treating every character as a full em-square (CHAR_WIDTH_MM = fontSize)
// assumes worst-case CJK monospacing, but real Noto Sans KR glyphs (and any mixed Latin) render
// narrower on average. Confirmed 2026-07-27 against a real generation's layout.json: a 56mm-wide,
// 98.78mm-tall box was sliced to exactly the formula's predicted capacity (338 of a computed-340
// char budget) and still rendered with substantial blank space at the bottom -- the box was correct,
// but the real text needed fewer lines than the uncalibrated formula assumed, so it finished early
// and the remainder was pushed to the next column even though the intended column had room left.
// A modest, conservative narrowing (10%) raises the estimated capacity to better match real
// rendering without risking overflow; if columns still finish early or start overflowing, adjust
// this factor rather than the formula shape.
export const CHAR_WIDTH_CALIBRATION_FACTOR = 0.9

export const CHAR_WIDTH_MM = BODY_FONT_SIZE_PT * PT_TO_MM * CHAR_WIDTH_CALIBRATION_FACTOR
export const LINE_HEIGHT_MM = BODY_LEADING_PT * PT_TO_MM

export const IMAGE_TEXT_GAP_MM = 6

// Spacing & margin constants for Phase 5 collision validation
export const COLUMN_GUTTER_MM = 4

// Narrowest a body-text column may get regardless of the user's grid column setting (confirmed
// 2026-07-16: a 5-column grid setting was squeezing body paragraphs into 23.2mm-wide columns --
// ~7 characters per line at 9pt Korean, unreadable). The grid's column count is an alignment
// guide for images/headings, not a mandate that body copy must flow that narrow. Raised from 35
// to 45mm (confirmed 2026-07-27: a 3-column grid setting produced exactly 36mm columns, which
// slipped past the old 35mm floor unchanged and still read as cramped, fragmented body text).
export const MIN_READABLE_COLUMN_WIDTH_MM = 45
export const TEXT_BOX_INNER_PADDING_MM = 2
export const TEXT_IMAGE_MIN_GAP_MM = 4
export const TEXT_TEXT_MIN_GAP_MM = 3
export const IMAGE_IMAGE_MIN_GAP_MM = 3
export const SECTION_TITLE_MARGIN_MM = 5

// Grid-based layout_plan system (v0.3): the LLM places elements on this grid instead of
// inventing mm coordinates directly. The grid spans the full physical page (not just the
// margin-constrained text box) so that full-bleed compositions (e.g. single_full_page) stay
// expressible; nothing in the fixed-constraint checklist requires text to avoid the margins.
export const GRID_COLUMNS = 6
export const GRID_ROWS = 12
export const GRID_GUTTER_MM = 4

// Section-opener title page (used only when the user supplies a title).
export const TITLE_FONT_SIZE_PT = 28
// >=1.25x the font size, consistent with the other heading roles' leading fix below (was 34pt,
// a 1.21x ratio -- confirmed 2026-07-27 too tight once a title needs more than one line).
export const TITLE_LEADING_PT = 36
export const TITLE_VERTICAL_POSITION_RATIO = 0.4 // title baseline sits 40% down the text box, not dead-center

// Per-role font size/leading, mirrored from templates/page_style_template.sty's \TitleText,
// \SectionTitleText, \CaseTitleKoText, etc. Anything that reflows text into a box by estimating
// character capacity (reorganizeTextOnlyPages.js) MUST size that box using the font the role will
// actually render in -- not always assume BODY_FONT_SIZE_PT (confirmed 2026-07-16: a 20mm-wide
// column sized for 9pt body text was rendered as bold 14pt \SectionTitleText, which doesn't fit
// that width and visually collided with the next column). Keep in sync with the .sty file by hand.
export const ROLE_FONT_SIZE_PT = {
  title: TITLE_FONT_SIZE_PT,
  section_title: 14,
  section_label: 14,
  case_title: 11,
  case_title_ko: 11,
  case_title_en: 10,
  case_body: BODY_FONT_SIZE_PT,
  credit: 7,
  label: 14,
  body: BODY_FONT_SIZE_PT,
}
// Kept in sync with page_style_template.sty's heading-role leading fix (2026-07-27): every
// bold heading role now uses >=1.25x its font size (was as low as 1.14x, visibly cramped once a
// heading wraps to 2+ lines).
export const ROLE_LEADING_PT = {
  title: TITLE_LEADING_PT,
  section_title: 18,
  section_label: 18,
  case_title: 14,
  case_title_ko: 14,
  case_title_en: 13,
  case_body: BODY_LEADING_PT,
  credit: 9,
  label: 18,
  body: BODY_LEADING_PT,
}
// Roles rendered \bfseries in the .sty run measurably wider per character than the same point
// size in regular weight; padding the assumed character width keeps the readable-width estimate
// from under-shooting for bold headings.
export const ROLE_BOLD_WIDTH_FACTOR = {
  title: 1.1,
  section_title: 1.1,
  section_label: 1.1,
  case_title: 1.1,
  case_title_ko: 1.1,
  case_title_en: 1.1,
}

