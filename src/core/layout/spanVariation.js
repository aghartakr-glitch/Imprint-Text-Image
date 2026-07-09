// Grid columns are an alignment/positioning unit for a modular editorial grid, not a mandate that
// every element must be exactly one column wide. This module detects the "rigid forced N-column
// text wall" failure mode (every text block squeezed into a uniform 1-column sliver, reported by a
// real generation where a 4-column grid produced four parallel narrow text strips splitting single
// sentences) and classifies the span pattern actually used, so both validateLayoutPlan (reject/flag)
// and generation-log.json (report) can consume the same analysis.
function describeSpanPattern(colSpans, columns) {
  const sorted = [...colSpans].sort((a, b) => b - a)
  if (sorted.length === 0) return null
  if (sorted.length === 1 && sorted[0] === columns) return 'full-width'
  const sum = sorted.reduce((a, b) => a + b, 0)
  if (sorted.length === 2 && sum <= columns) return `${sorted[0]}+${sorted[1]}`
  if (sum < columns) return 'intentional-empty-column'
  return null
}

// Analyzes ONE page's text elements (plain grid-unit elements, i.e. plan.pages[i].elements
// filtered to type: 'text') and returns { colSpans, pattern }.
function analyzePage(textElements, columns) {
  const colSpans = textElements.map((el) => el.col_span).filter((n) => Number.isInteger(n))
  return { colSpans, pattern: describeSpanPattern(colSpans, columns) }
}

// Full-plan analysis for a grid_spec-based (column_flow_grid) plan. Returns the exact field set
// requested for generation-log.json's grid_interpretation block, plus a `forcedRigidColumns` flag
// validateLayoutPlan uses to reject/penalize.
export function analyzeSpanVariation(plan) {
  const columns = plan.grid_spec?.columns ?? plan.grid?.columns
  const pages = Array.isArray(plan.pages) ? plan.pages : []
  const allTextElements = pages.flatMap((p) => (p.elements ?? []).filter((el) => el.type === 'text'))
  const allImageElements = pages.flatMap((p) => (p.elements ?? []).filter((el) => el.type === 'image'))

  const textColSpans = allTextElements.map((el) => el.col_span).filter((n) => Number.isInteger(n))
  const imageColSpans = allImageElements.map((el) => el.col_span).filter((n) => Number.isInteger(n))
  const distinctTextSpans = new Set(textColSpans)
  const distinctImageSpans = new Set(imageColSpans)

  const allTextForcedToSingleColumns = Number.isInteger(columns) && columns >= 3
    && textColSpans.length > 0 && textColSpans.every((s) => s === 1)
  const noSpanVariation = textColSpans.length > 1 && distinctTextSpans.size <= 1
  const imagesNeverSpanMultiple = imageColSpans.length > 0 && imageColSpans.every((s) => s <= 1)
  const noImageSpanVariation = imageColSpans.length > 1 && distinctImageSpans.size <= 1

  const spanPatterns = [...new Set(
    pages.map((p) => analyzePage((p.elements ?? []).filter((el) => el.type === 'text'), columns).pattern).filter(Boolean),
  )]

  // Text span patterns for generation-log
  const textSpanPatterns = Array.from(distinctTextSpans).sort((a, b) => a - b).map((s) => `${s}-column`)

  // Image span patterns for generation-log
  const imageSpanPatterns = Array.from(distinctImageSpans).sort((a, b) => a - b).map((s) => `${s}-column`)

  // Only an all-1-column text wall is a real typesetting failure (splits sentences into narrow
  // slivers). Uniform-but-wider spans (e.g. every body block at 2-column) is a legitimate,
  // common editorial reading layout -- it must not be rejected outright, only flagged as a
  // quality/diversity penalty. See validateLayoutPlan.js: forcedRigidColumns blocks the
  // candidate, noSpanVariation is a warning only.
  const forcedRigidColumns = allTextForcedToSingleColumns

  return {
    grid_interpretation: 'alignment_structure_not_forced_columns',
    span_variation_used: distinctTextSpans.size >= 2 || spanPatterns.length > 0,
    text_span_variation_used: distinctTextSpans.size >= 2,
    image_span_variation_used: distinctImageSpans.size >= 2,
    text_span_patterns: textSpanPatterns,
    image_span_patterns: imageSpanPatterns,
    span_patterns: spanPatterns,
    all_text_forced_to_single_columns: allTextForcedToSingleColumns,
    readable_text_width_passed: !allTextForcedToSingleColumns,
    intentional_whitespace_regions: [],
    rejected_because_forced_four_column_text: forcedRigidColumns,
    forcedRigidColumns,
    noTextSpanVariationWarning: noSpanVariation && !allTextForcedToSingleColumns,
    imagesNeverSpanMultiple,
    noImageSpanVariation,
  }
}
