// Spec Phase 3.3: CMF stories masonry layout builder
// For 5+ images with short descriptions: masonry-style layout with varied image sizes

export function buildCmfStoriesMasonry({ imageCount, textDensity, contentStructure, userGridSettings = {} }) {
  if (imageCount < 5 || textDensity !== 'short') {
    return null // Not applicable
  }

  const gridColumns = userGridSettings.columns ?? 6
  const gridRows = userGridSettings.rows ?? 12
  const imagesPerPage = Math.ceil(imageCount / 2) // Spread images across 2-3 pages

  // Masonry pattern: vary image sizes (some full-width, some half, some third)
  // Pattern: 1 hero (full width), then 2 half-width, 1 two-third, etc.
  const elements = []
  let page = 1
  let rowOffset = 1
  let colOffset = 1

  for (let i = 0; i < imageCount; i++) {
    let colSpan, rowSpan

    // Vary sizes: hero every 5, otherwise mixed
    if (i === 0) {
      colSpan = gridColumns
      rowSpan = 4
    } else if (i % 3 === 1) {
      colSpan = Math.floor(gridColumns / 2)
      rowSpan = 3
    } else if (i % 3 === 2) {
      colSpan = Math.floor(gridColumns / 2)
      rowSpan = 3
    } else {
      colSpan = gridColumns
      rowSpan = 3
    }

    // Move to next page if current row would overflow
    if (rowOffset + rowSpan > gridRows + 1) {
      page += 1
      rowOffset = 1
      colOffset = 1
    }

    elements.push({
      id: `image_${i + 1}`,
      type: 'image',
      role: i === 0 ? 'hero' : 'gallery',
      page,
      col_start: colOffset,
      col_span: colSpan,
      row_start: rowOffset,
      row_span: rowSpan,
      fit: 'contain',
      object_position: 'center',
    })

    // Advance row for next image
    rowOffset += rowSpan + 1 // +1 for spacing

    // If this was a half-width image and next would also be half-width, stay on same row
    if (colSpan < gridColumns && i + 1 < imageCount && (i + 1) % 3 !== 0) {
      colOffset += colSpan
      rowOffset -= rowSpan + 1 // Go back to previous row
    } else {
      colOffset = 1
    }
  }

  // Build pages from elements
  const pages = []
  const pageNumbers = [...new Set(elements.map((el) => el.page))]
  for (const pageNum of pageNumbers) {
    pages.push({
      page: pageNum,
      elements: elements.filter((el) => el.page === pageNum),
    })
  }

  return {
    candidate_id: 'builtin_cmf_masonry_1',
    style: 'Editorial',
    output_unit: 'spread',
    layout_family: 'cmf_stories_masonry',
    layout_purpose: 'gallery',
    image_hierarchy: 'grid_gallery',
    image_text_relation: 'gallery_with_related_text',
    composition_strategy: 'gallery_page_text_page',
    base_pattern_reference: 'masonry_gallery',
    layout_intent: `Masonry gallery with ${imageCount} images across spread`,
    design_sequence: [
      { step: 1, decision_type: 'layout_family', value: 'cmf_stories_masonry', reason: `${imageCount} images masonry detected` },
      { step: 2, decision_type: 'composition_strategy', value: 'gallery_page_text_page', reason: 'Images gallery, short captions' },
      { step: 3, decision_type: 'image_hierarchy', value: 'grid_gallery', reason: 'Equal importance with varied sizing' },
    ],
    grid: { columns: gridColumns, rows: gridRows },
    grid_spec: {
      columns: gridColumns,
      rows: gridRows,
      page_size: userGridSettings.page_size || 'A5',
      margin_preset: userGridSettings.margin_preset || 'recommended',
      gutter_mm: userGridSettings.gutter_mm || 4,
      grid_mode: userGridSettings.grid_mode || 'flexible', // Masonry works better in flexible mode
    },
    reserved_regions: elements.map((el) => ({
      page: el.page,
      col_start: el.col_start,
      col_span: el.col_span,
      row_start: el.row_start,
      row_span: el.row_span,
    })),
    text_flow: {
      mode: 'column_flow',
      flow_regions: pageNumbers.map((pageNum) => ({
        page: pageNum,
        col_start: 1,
        col_span: gridColumns,
        row_start: 1,
        row_span: gridRows,
      })),
      overflow_policy: { body_overflow: 'continue_to_next_page' },
    },
    layout_variation: 'masonry_gallery',
    pages,
    title_behavior: 'title_page_only',
    overflow_policy: { body_overflow: 'continue_to_next_page' },
    reason: `Masonry gallery for ${imageCount} images`,
  }
}
