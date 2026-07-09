// Proximity validation: ensure related images and texts stay close together.
// High-confidence image-text pairs (confidence >= 0.7) must be on same page or adjacent pages.

export function validateProximity(resolvedPages, inferredImageTextRelations = []) {
  const issues = []

  if (!Array.isArray(inferredImageTextRelations) || inferredImageTextRelations.length === 0) {
    return { passed: true, issues: [] }
  }

  // Build element location map: { elementId → { page, col_start, col_span, row_start, row_span } }
  const elementLocations = {}
  resolvedPages.forEach((page, pageIdx) => {
    const pageNum = pageIdx + 1

    // Images
    ;(page.images || []).forEach((img, imgIdx) => {
      const imgId = img.id || `image_${imgIdx + 1}`
      elementLocations[imgId] = {
        page: pageNum,
        col_start: img.col_start ?? 1,
        col_span: img.col_span ?? 6,
        row_start: img.row_start ?? 1,
        row_span: img.row_span ?? 6,
      }
    })

    // Text blocks
    if (Array.isArray(page.textBlocks)) {
      page.textBlocks.forEach((tb) => {
        if (tb.id) {
          elementLocations[tb.id] = {
            page: pageNum,
            col_start: tb.zone?.col_start ?? 1,
            col_span: tb.zone?.col_span ?? 6,
            row_start: tb.zone?.row_start ?? 1,
            row_span: tb.zone?.row_span ?? 6,
          }
        }
      })
    }

    // Legacy textZone/textSlice
    if (page.textZone && page.textZone.id) {
      elementLocations[page.textZone.id] = {
        page: pageNum,
        col_start: page.textZone.col_start ?? 1,
        col_span: page.textZone.col_span ?? 6,
        row_start: page.textZone.row_start ?? 1,
        row_span: page.textZone.row_span ?? 6,
      }
    }
  })

  // Check each high-confidence relation
  inferredImageTextRelations.forEach((rel) => {
    if (rel.confidence < 0.7) return // Skip low-confidence

    const textLoc = elementLocations[rel.text_block_id]
    const imageLoc = elementLocations[rel.image_id]

    if (!textLoc || !imageLoc) {
      // Element not found in layout (shouldn't happen if layout is valid)
      return
    }

    const pageDist = Math.abs(textLoc.page - imageLoc.page)

    // Rule: same page OR adjacent page (max 1 page apart)
    if (pageDist > 1) {
      issues.push({
        type: 'proximity_violation',
        text_block_id: rel.text_block_id,
        image_id: rel.image_id,
        confidence: rel.confidence,
        text_page: textLoc.page,
        image_page: imageLoc.page,
        page_distance: pageDist,
        severity: pageDist >= 3 ? 'error' : 'warning',
        reason: `High-confidence pair split ${pageDist} pages apart (must be <=1 for conf=${rel.confidence.toFixed(2)})`,
      })
    }
  })

  return {
    passed: issues.filter((i) => i.severity === 'error').length === 0,
    issues,
  }
}
