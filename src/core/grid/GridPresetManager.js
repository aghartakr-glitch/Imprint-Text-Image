// Spec section 5.1/2: turns the 4 user-facing settings (page_size, margin_preset, columns,
// grid_mode) plus a few content signals (text_density, paragraph count, image count) into the
// full resolved_grid_settings object. Users never see rows/gutter/text_flow/image_behavior/
// variation_level directly -- this is where those get decided.
//
// page_size/margin_preset -> mm dimensions now comes from layoutConstants.js's
// resolvePageGeometry(), the single source of truth (2026-07-28) -- this file used to keep its OWN
// separate copy of these two tables (with a stale margin_preset.recommended.bottom of 18mm that
// had drifted from layoutConstants.js's deliberately-equalized 16mm), and neither copy was ever
// actually consumed by the downstream text-capacity/row-sizing math (gridToMm,
// estimateTextCapacityMm, buildLatex.js's `\geometry{}`) -- everything past this file used the
// hardcoded A5 constants regardless of what page_size the user picked. Confirmed 2026-07-28: a
// real generation with page_size:"B5" (176x250mm) was measured against A5's 116x178mm content box
// everywhere except this one resolution step, so B5/A4 were selectable but silently broken.
import { resolvePageGeometry } from '../layoutConstants.js'

// Widened 2026-07-27: the user marked the column gutter as visibly too narrow on real output.
// Values still scale down as columns increase (more columns need to give width back to content),
// but every tier moved up.
const GRID_PRESETS = [
  { id: 'two_column', columns: 2, gutterMm: 7 },
  { id: 'three_column', columns: 3, gutterMm: 6 },
  { id: 'four_column_editorial', columns: 4, gutterMm: 5.5 },
  { id: 'five_column_editorial', columns: 5, gutterMm: 5 },
  { id: 'six_column_flexible', columns: 6, gutterMm: 4.5 },
]

function presetForColumns(columns) {
  return GRID_PRESETS.find((p) => p.columns === columns) ?? GRID_PRESETS.find((p) => p.columns === 4)
}

// Section 2.1: several (page_size, columns) combinations are given as "12 or 16" in the spec.
// Deterministically resolved to the simpler value (12) except where the spec gives only one
// answer (every A4 combination is 16 rows).
function resolveRows(pageSize) {
  if (pageSize === 'A4') return 16
  return 12
}

// Section 2.2, with margin_preset nudging it slightly narrower/wider.
function resolveGutterMm(columns, marginPreset) {
  const base = presetForColumns(columns).gutterMm
  if (marginPreset === 'narrow') return Math.max(3, base - 1)
  if (marginPreset === 'wide') return base + 1
  return base
}

// Section 2.3: paragraph count takes priority over density when it signals a real multi-section
// structure ("문단 3개 이상 → paragraph-aware column_flow 우선").
export function resolveTextFlow({ textDensity, paragraphCount = 0 }) {
  if (paragraphCount >= 3) return 'column_flow'
  if (textDensity === 'long') return 'column_flow'
  if (!textDensity || textDensity === 'none') return 'none'
  return 'block_flow'
}

// Section 2.4: one deterministic pick per bucket (the spec offers "A 또는 B" alternatives; a
// single consistent choice keeps this reproducible/testable).
export function resolveImageBehavior({ imageCount, textDensity }) {
  if (imageCount === 0) return 'none'
  if (imageCount >= 3) return 'distributed'
  if (imageCount === 1 && textDensity !== 'long') return 'full_width'
  return 'anchored'
}

// Section 2.5.
export function resolveVariationLevel({ gridMode, textDensity, imageCount }) {
  if (gridMode === 'strict') return 'low'
  if (imageCount >= 3) return 'high'
  if (textDensity === 'medium' || textDensity === 'long') return 'medium'
  return 'low'
}

// Main entry point: user's 4 settings + content signals -> the full grid_spec plus
// resolved_grid_settings (with per-field resolution_reason strings for generation-log.json).
export function resolveGridSettings({
  pageSize,
  page_size: pageSizeSnake,
  marginPreset,
  margin_preset: marginPresetSnake,
  columns = 4,
  gridMode,
  grid_mode: gridModeSnake,
} = {}, {
  textDensity = 'short', paragraphCount = 0, imageCount = 1,
} = {}) {
  const resolvedPageSize = pageSize ?? pageSizeSnake ?? 'A5'
  const resolvedMarginPreset = marginPreset ?? marginPresetSnake ?? 'recommended'
  const resolvedGridMode = gridMode ?? gridModeSnake ?? 'strict'

  const preset = presetForColumns(columns)
  const rows = resolveRows(resolvedPageSize)
  const gutterMm = resolveGutterMm(columns, resolvedMarginPreset)
  const textFlow = resolveTextFlow({ textDensity, paragraphCount })
  const imageBehavior = resolveImageBehavior({ imageCount, textDensity })
  const variationLevel = resolveVariationLevel({ gridMode: resolvedGridMode, textDensity, imageCount })
  const geometry = resolvePageGeometry(resolvedPageSize, resolvedMarginPreset)

  return {
    grid_spec: {
      page_size: resolvedPageSize,
      margin_preset: resolvedMarginPreset,
      preset: preset.id,
      columns,
      rows,
      gutter_mm: gutterMm,
      grid_mode: resolvedGridMode,
    },
    page_width_mm: geometry.pageWidthMm,
    page_height_mm: geometry.pageHeightMm,
    margins_mm: {
      top: geometry.marginTopMm, bottom: geometry.marginBottomMm, inner: geometry.marginInnerMm, outer: geometry.marginOuterMm,
    },
    resolved_grid_settings: {
      rows,
      gutter_mm: gutterMm,
      text_flow: textFlow,
      image_behavior: imageBehavior,
      variation_level: variationLevel,
      resolution_reason: {
        rows: `${resolvedPageSize}${columns ? ` with ${columns} columns` : ''} uses ${rows} rows by default.`,
        gutter: `${columns} columns use ${gutterMm}mm gutter${resolvedMarginPreset !== 'recommended' ? ` (adjusted for ${resolvedMarginPreset} margins)` : ''}.`,
        text_flow: paragraphCount >= 3
          ? `${paragraphCount} paragraphs favor paragraph-aware column flow.`
          : `Body text density is ${textDensity}.`,
        image_behavior: `${imageCount} image(s) resolved to ${imageBehavior} behavior.`,
        variation_level: `grid_mode=${resolvedGridMode}${imageCount >= 3 ? ', 3+ images' : ''}${(textDensity === 'medium' || textDensity === 'long') ? `, ${textDensity} text` : ''} resolves to ${variationLevel} variation.`,
      },
    },
  }
}
