// A5 remains the default/fallback page size -- every constant below still describes A5 exactly as
// before, so any caller that doesn't know about a specific generation's page_size (tests, legacy
// call sites) keeps its old behavior unchanged.
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

// Single source of truth for page_size/margin_preset -> real mm dimensions. Previously duplicated
// (GridPresetManager.js kept its own separate copy) AND, critically, never actually consumed by
// anything downstream of grid_spec generation -- every text-capacity/row-sizing calculation
// (gridToMm, estimateTextCapacityMm, repairTextOverflow.js, repairContentGroupLayout.js) and even
// the final rendered PDF (buildLatex.js's `\geometry{}`) used the hardcoded A5 constants above
// regardless of what page_size was actually chosen. Confirmed 2026-07-28: a real generation with
// page_size:"B5" (176x250mm, a genuinely larger page) was still measured against A5's 116x178mm
// content box, so a paragraph that would fit comfortably on the real B5 page was rejected as
// "overflowing" a box the layout was never actually going to use -- B5/A4 were selectable in the
// UI but silently produced wrong results everywhere except the metadata field itself.
export const PAGE_SIZES_MM = {
  A5: { widthMm: 148, heightMm: 210 },
  A4: { widthMm: 210, heightMm: 297 },
  B5: { widthMm: 176, heightMm: 250 },
}

export const MARGIN_PRESETS_MM = {
  recommended: {
    top: 16, bottom: 16, inner: 18, outer: 14,
  },
  narrow: {
    top: 12, bottom: 12, inner: 14, outer: 10,
  },
  wide: {
    top: 20, bottom: 20, inner: 22, outer: 18,
  },
}

// Resolves a plan's grid_spec.page_size/margin_preset into the real mm geometry every downstream
// calculation needs. Unknown/missing values fall back to A5/recommended (this project's default),
// so a plan that omits page_size entirely (legacy shape, or a test fixture) behaves exactly as it
// did before this function existed.
export function resolvePageGeometry(pageSize, marginPreset) {
  const page = PAGE_SIZES_MM[pageSize] ?? PAGE_SIZES_MM.A5
  const margins = MARGIN_PRESETS_MM[marginPreset] ?? MARGIN_PRESETS_MM.recommended
  return {
    pageWidthMm: page.widthMm,
    pageHeightMm: page.heightMm,
    marginTopMm: margins.top,
    marginBottomMm: margins.bottom,
    marginInnerMm: margins.inner,
    marginOuterMm: margins.outer,
    textBoxWidthMm: page.widthMm - margins.inner - margins.outer,
    textBoxHeightMm: page.heightMm - margins.top - margins.bottom,
  }
}

export const BODY_FONT_SIZE_PT = 9
// Nudged 14 -> 15pt (2026-07-27): user reported the overall leading read as slightly cramped.
export const BODY_LEADING_PT = 15
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
// Widened 2026-07-27 alongside GridPresetManager's per-column gutter table -- was visibly too
// narrow on real output.
export const GRID_GUTTER_MM = 4.5

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
  caption: 6.5,
  label: 14,
  body: BODY_FONT_SIZE_PT,
}
// Kept in sync with page_style_template.sty's heading-role leading fix (2026-07-27): every
// bold heading role now uses >=1.25x its font size (was as low as 1.14x, visibly cramped once a
// heading wraps to 2+ lines).
// Nudged up by 1pt per role 2026-07-27 (alongside BODY_LEADING_PT) for the same "slightly cramped"
// feedback, plus a second-order fix: a heading split into two stacked blocks (e.g. a Korean heading
// line directly followed by its English counterpart, no blank line between them) used to look
// tighter or looser than the SAME heading wrapped as one intrinsic multi-line block, because the
// two rendering paths used unrelated spacing math. Bumping the intrinsic leading here moves the
// single-block case closer to the custom inter-block gap in repairContentGroupLayout.js, so both
// read at roughly the same line-to-line rhythm instead of one being visibly tighter.
export const ROLE_LEADING_PT = {
  title: TITLE_LEADING_PT,
  section_title: 19,
  section_label: 19,
  case_title: 15,
  case_title_ko: 15,
  case_title_en: 14,
  case_body: BODY_LEADING_PT,
  credit: 9,
  caption: 8,
  label: 19,
  body: BODY_LEADING_PT,
}
// Roles rendered \bfseries in the .sty run measurably wider per character than the same point
// size in regular weight; padding the assumed character width keeps the readable-width estimate
// from under-shooting for bold headings.
// title's factor is measured, not guessed: a real XeLaTeX \settowidth compile of \TitleText
// (28pt bold NotoSansKR, all-caps Latin) measured the 26-letter alphabet at 483.25pt = 170.5mm,
// i.e. ~6.56mm/char average -- but the old 1.1 factor (assuming bold is WIDER than the shared
// body-text calibration) predicted ~9.78mm/char, a 46% overestimate. That made any title over
// ~11 characters ("BAUHAUS BUILDING", "WALTER GROPIUS") get predicted as needing 2 lines and
// sized ~2.35x taller than its real 1-line render, leaving a large empty gap before the subtitle
// below it -- confirmed 2026-07-28 from real output where short titles ("BAUHAUS", "CATHEDRAL")
// stayed tight against their subtitle but longer ones visibly floated away from it, even though
// the coded box-to-box gap was identical (1mm) in both cases. Solved for the factor that makes
// the estimate match the measured 6.56mm/char: 6.56 / (28 * PT_TO_MM * CHAR_WIDTH_CALIBRATION_FACTOR).
export const ROLE_BOLD_WIDTH_FACTOR = {
  title: 0.74,
  section_title: 1.1,
  section_label: 1.1,
  case_title: 1.1,
  case_title_ko: 1.1,
  case_title_en: 1.1,
}

