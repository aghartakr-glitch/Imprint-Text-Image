// Direct mm-coordinate collision detection and fixing for layout.json
// Detects when images and text blocks overlap or have insufficient gap
// and automatically adjusts text block positions to maintain minimum spacing.

const TEXT_IMAGE_MIN_GAP_MM = 5 // Increased from 4mm for better safety
const TEXT_TEXT_MIN_GAP_MM = 3
const IMAGE_IMAGE_MIN_GAP_MM = 3

// Rectangle overlap check
function rectsOverlap(r1, r2) {
  return (
    r1.x < r2.x + r2.w &&
    r1.x + r1.w > r2.x &&
    r1.y < r2.y + r2.h &&
    r1.y + r1.h > r2.y
  )
}

// Check if rectangles are too close (have insufficient gap)
function hasInsufficientGap(r1, r2, minGapMm) {
  if (!rectsOverlap(r1, r2)) {
    // Not overlapping, but check gap
    if (r1.x < r2.x + r2.w && r1.x + r1.w > r2.x) {
      // Horizontally aligned/overlapping
      if (r1.y < r2.y && r1.y + r1.h > r2.y - minGapMm) {
        // r1 is above r2 with insufficient gap
        return true
      }
      if (r2.y < r1.y && r2.y + r2.h > r1.y - minGapMm) {
        // r2 is above r1 with insufficient gap
        return true
      }
    }
  }
  return false
}

export function validateAndFixLayoutMm(plan) {
  if (!Array.isArray(plan.pages)) {
    return { plan, fixed: false, issues: [] }
  }

  const issues = []
  const fixedPlan = JSON.parse(JSON.stringify(plan))
  let anyFixed = false
  const pageHeightMm = plan.grid_spec?.page_height_mm ?? 210

  fixedPlan.pages.forEach((page) => {
    if (!Array.isArray(page.images) || !Array.isArray(page.textBlocks)) return

    // Check each text block against each image
    page.textBlocks.forEach((txtBlockDef) => {
      const textBox = {
        x: txtBlockDef.zone.xMm,
        y: txtBlockDef.zone.yMm,
        w: txtBlockDef.zone.wMm,
        h: txtBlockDef.zone.hMm,
      }

      for (const img of page.images) {
        const imgBox = { x: img.xMm, y: img.yMm, w: img.wMm, h: img.hMm }
        const overlaps = rectsOverlap(textBox, imgBox)
        const closeGap = hasInsufficientGap(textBox, imgBox, TEXT_IMAGE_MIN_GAP_MM)

        if (overlaps || closeGap) {
          // Move text block below image with proper gap
          const newY = imgBox.y + imgBox.h + TEXT_IMAGE_MIN_GAP_MM

          if (newY + textBox.h <= pageHeightMm) {
            // Can fit below image
            txtBlockDef.zone.yMm = newY
            anyFixed = true
            issues.push({
              page: page.page,
              element: txtBlockDef.id,
              type: overlaps ? 'overlap' : 'insufficient_gap',
              fixed: `Moved to y=${newY.toFixed(1)}mm (below image)`,
            })
          } else {
            // Can't fit below, try above
            const altY = imgBox.y - textBox.h - TEXT_IMAGE_MIN_GAP_MM
            if (altY >= 0) {
              txtBlockDef.zone.yMm = altY
              anyFixed = true
              issues.push({
                page: page.page,
                element: txtBlockDef.id,
                type: overlaps ? 'overlap' : 'insufficient_gap',
                fixed: `Moved to y=${altY.toFixed(1)}mm (above image)`,
              })
            } else {
              issues.push({
                page: page.page,
                element: txtBlockDef.id,
                type: 'cannot_fix',
                reason: 'No free space on page',
              })
            }
          }
        }
      }
    })
  })

  return { plan: fixedPlan, fixed: anyFixed, issues }
}
