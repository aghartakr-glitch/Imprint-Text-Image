// Spec section 5.1/2: turns the 4 user-facing settings (page_size, margin_preset, columns,
// grid_mode) plus a few content signals (text_density, paragraph count, image count) into the
// full resolved_grid_settings object. Users never see rows/gutter/text_flow/image_behavior/
// variation_level directly -- this is where those get decided.
const PAGE_SIZES_MM = {
  A5: { widthMm: 148, heightMm: 210 },
  A4: { widthMm: 210, heightMm: 297 },
  B5: { widthMm: 176, heightMm: 250 },
}

const MARGIN_PRESETS_MM = {
  recommended: {
    top: 16, bottom: 18, inner: 18, outer: 14,
  },
  narrow: {
    top: 12, bottom: 14, inner: 14, outer: 10,
  },
  wide: {
    top: 20, bottom: 24, inner: 22, outer: 18,
  },
}

const GRID_PRESETS = [
  { id: 'two_column', columns: 2, gutterMm: 5 },
  { id: 'three_column', columns: 3, gutterMm: 4.5 },
  { id: 'four_column_editorial', columns: 4, gutterMm: 4 },
  { id: 'six_column_flexible', columns: 6, gutterMm: 3 },
]

function presetForColumns(columns) {
  return GRID_PRESETS.find((p) => p.columns === columns) ?? GRID_PRESETS.find((p) => p.columns === 4)
}

// "custom" page_size/margin_preset fall back to A5/recommended -- this system doesn't expose
// numeric custom-value inputs yet, so custom is accepted as a value but resolves like the default.
function resolvePageDims(pageSize) {
  return PAGE_SIZES_MM[pageSize] ?? PAGE_SIZES_MM.A5
}
function resolveMargins(marginPreset) {
  return MARGIN_PRESETS_MM[marginPreset] ?? MARGIN_PRESETS_MM.recommended
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
  pageSize = 'A5', marginPreset = 'recommended', columns = 4, gridMode = 'strict',
}, {
  textDensity = 'short', paragraphCount = 0, imageCount = 1,
} = {}) {
  const preset = presetForColumns(columns)
  const rows = resolveRows(pageSize)
  const gutterMm = resolveGutterMm(columns, marginPreset)
  const textFlow = resolveTextFlow({ textDensity, paragraphCount })
  const imageBehavior = resolveImageBehavior({ imageCount, textDensity })
  const variationLevel = resolveVariationLevel({ gridMode, textDensity, imageCount })
  const pageDims = resolvePageDims(pageSize)
  const margins = resolveMargins(marginPreset)

  return {
    grid_spec: {
      page_size: pageSize,
      margin_preset: marginPreset,
      preset: preset.id,
      columns,
      rows,
      gutter_mm: gutterMm,
      grid_mode: gridMode,
    },
    page_width_mm: pageDims.widthMm,
    page_height_mm: pageDims.heightMm,
    margins_mm: margins,
    resolved_grid_settings: {
      rows,
      gutter_mm: gutterMm,
      text_flow: textFlow,
      image_behavior: imageBehavior,
      variation_level: variationLevel,
      resolution_reason: {
        rows: `${pageSize}${columns ? ` with ${columns} columns` : ''} uses ${rows} rows by default.`,
        gutter: `${columns} columns use ${gutterMm}mm gutter${marginPreset !== 'recommended' ? ` (adjusted for ${marginPreset} margins)` : ''}.`,
        text_flow: paragraphCount >= 3
          ? `${paragraphCount} paragraphs favor paragraph-aware column flow.`
          : `Body text density is ${textDensity}.`,
        image_behavior: `${imageCount} image(s) resolved to ${imageBehavior} behavior.`,
        variation_level: `grid_mode=${gridMode}${imageCount >= 3 ? ', 3+ images' : ''}${(textDensity === 'medium' || textDensity === 'long') ? `, ${textDensity} text` : ''} resolves to ${variationLevel} variation.`,
      },
    },
  }
}
