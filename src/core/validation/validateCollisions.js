// Collision detection and gap validation for grid-based layouts.
// Prevents text and image overlap, ensures minimum spacing (gutter/gap).

function boxesOverlap(a, b) {
  // Both boxes must be on the same page
  if (a.page !== b.page) return false

  // Check rectangular overlap in grid coordinates
  const aColEnd = a.col_start + a.col_span - 1
  const bColEnd = b.col_start + b.col_span - 1
  const aRowEnd = a.row_start + a.row_span - 1
  const bRowEnd = b.row_start + b.row_span - 1

  return (
    a.col_start <= bColEnd &&
    aColEnd >= b.col_start &&
    a.row_start <= bRowEnd &&
    aRowEnd >= b.row_start
  )
}

function getGapGridUnits(a, b) {
  // Minimum gap between elements in grid units
  // Returns minimum distance (could be negative if overlapping)
  if (a.page !== b.page) return Infinity

  const aColEnd = a.col_start + a.col_span - 1
  const bColEnd = b.col_start + b.col_span - 1
  const aRowEnd = a.row_start + a.row_span - 1
  const bRowEnd = b.row_start + b.row_span - 1

  // Horizontal gap
  let hGap = Infinity
  if (a.col_start > bColEnd) hGap = a.col_start - bColEnd - 1
  else if (b.col_start > aColEnd) hGap = b.col_start - aColEnd - 1

  // Vertical gap
  let vGap = Infinity
  if (a.row_start > bRowEnd) vGap = a.row_start - bRowEnd - 1
  else if (b.row_start > aRowEnd) vGap = b.row_start - aRowEnd - 1

  return Math.min(hGap, vGap)
}

export function validateCollisions(plan, { gridMode = 'strict' } = {}) {
  const issues = []
  const pages = Array.isArray(plan.pages) ? plan.pages : []

  // Minimum gaps (in grid units; will be converted to mm later)
  const MIN_GAP_STRICT = 1 // at least 1 gutter
  const MIN_GAP_FLEXIBLE = 0.75

  pages.forEach((page) => {
    const elements = Array.isArray(page.elements) ? page.elements : []

    // Check all pairs for overlap/gap
    for (let i = 0; i < elements.length; i += 1) {
      for (let j = i + 1; j < elements.length; j += 1) {
        const a = elements[i]
        const b = elements[j]

        // Skip if different pages
        if (a.page !== b.page) continue

        // Check forbidden overlaps
        const aIsImage = a.type === 'image'
        const bIsImage = b.type === 'image'
        const aIsText = a.type === 'text'
        const bIsText = b.type === 'text'

        if (boxesOverlap(a, b)) {
          // Text-Image overlap is forbidden
          if ((aIsText && bIsImage) || (aIsImage && bIsText)) {
            issues.push({
              type: 'text_image_overlap',
              page: a.page,
              element_a: a.id,
              element_b: b.id,
              severity: 'error',
              reason: 'Text block overlaps image reserved region.',
            })
          }
          // Image-Image overlap is forbidden (unless explicitly grouped)
          if (aIsImage && bIsImage) {
            issues.push({
              type: 'image_image_overlap',
              page: a.page,
              element_a: a.id,
              element_b: b.id,
              severity: 'error',
              reason: 'Images overlap (should not happen in modular grid layout).',
            })
          }
          // Text-Text overlap is forbidden (unless part of same flow region)
          if (aIsText && bIsText) {
            issues.push({
              type: 'text_text_overlap',
              page: a.page,
              element_a: a.id,
              element_b: b.id,
              severity: 'error',
              reason: 'Text blocks overlap.',
            })
          }
        } else {
          // Check minimum gap (if not overlapping)
          const gap = getGapGridUnits(a, b)
          const minGap = gridMode === 'strict' ? MIN_GAP_STRICT : MIN_GAP_FLEXIBLE

          if ((aIsText && bIsImage) || (aIsImage && bIsText)) {
            if (gap < minGap && gap >= 0) {
              issues.push({
                type: 'insufficient_gap_text_image',
                page: a.page,
                element_a: a.id,
                element_b: b.id,
                severity: 'warning',
                gap_grid_units: gap,
                required_gap_grid_units: minGap,
                reason: `Text and image too close (${gap} grid units, require ${minGap}).`,
              })
            }
          }
        }
      }
    }
  })

  return {
    passed: issues.filter((i) => i.severity === 'error').length === 0,
    issues,
  }
}
