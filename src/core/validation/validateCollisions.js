// Collision detection and gap validation for grid-based layouts.
// Prevents text and image overlap, ensures minimum spacing (gutter/gap).
// Phase 5: Supports both grid-unit and expanded bounding box (mm) collision checks.

import { gridToMm } from '../gridToMm.js'
import {
  TEXT_BOX_INNER_PADDING_MM,
  TEXT_IMAGE_MIN_GAP_MM,
  TEXT_TEXT_MIN_GAP_MM,
  IMAGE_IMAGE_MIN_GAP_MM,
  PAGE_WIDTH_MM,
  PAGE_HEIGHT_MM,
  GRID_COLUMNS,
  GRID_ROWS,
} from '../layoutConstants.js'

// Get expanded bounding box with safe margins (mm)
// columns/rows default to the fallback grid constants but MUST be passed as the plan's
// actual active grid (grid_spec.columns/rows or plan.grid.columns/rows) -- otherwise a
// candidate correctly laid out on e.g. a user-chosen 4-column grid gets its col_start/col_span
// mis-converted to mm using the hardcoded 6-column assumption, producing false collisions
// between elements that don't actually overlap (confirmed 2026-07-09).
function getExpandedBox(el, safeMarginMm = 1.5, columns = GRID_COLUMNS, rows = GRID_ROWS) {
  // Use unified gridToMm conversion for consistency with renderer
  const mmBox = gridToMm(el, { columns, rows })

  // For text boxes, add inner padding
  const innerPadding = el.type === 'text' ? TEXT_BOX_INNER_PADDING_MM : 0

  // Expanded box with safe margins
  return {
    x: mmBox.xMm - safeMarginMm,
    y: mmBox.yMm - safeMarginMm,
    w: mmBox.wMm + safeMarginMm * 2,
    h: mmBox.hMm + safeMarginMm * 2,
    innerPadding,
  }
}

// Check if two expanded boxes overlap (mm coordinates)
function expandedBoxesOverlap(boxA, boxB) {
  return (
    boxA.x < boxB.x + boxB.w &&
    boxA.x + boxA.w > boxB.x &&
    boxA.y < boxB.y + boxB.h &&
    boxA.y + boxA.h > boxB.y
  )
}

// Calculate gap between two expanded boxes (mm)
function getGapExpandedBoxes(boxA, boxB) {
  let hGap = Infinity
  let vGap = Infinity

  // Horizontal gap
  if (boxA.x > boxB.x + boxB.w) {
    hGap = boxA.x - (boxB.x + boxB.w)
  } else if (boxB.x > boxA.x + boxA.w) {
    hGap = boxB.x - (boxA.x + boxA.w)
  }

  // Vertical gap
  if (boxA.y > boxB.y + boxB.h) {
    vGap = boxA.y - (boxB.y + boxB.h)
  } else if (boxB.y > boxA.y + boxA.h) {
    vGap = boxB.y - (boxA.y + boxA.h)
  }

  return Math.min(hGap, vGap)
}

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

export function validateCollisions(plan, { gridMode = 'strict', useExpandedBbox = true } = {}) {
  const issues = []
  const pages = Array.isArray(plan.pages) ? plan.pages : []
  const activeColumns = plan.grid_spec?.columns ?? plan.grid?.columns ?? GRID_COLUMNS
  const activeRows = plan.grid_spec?.rows ?? plan.grid?.rows ?? GRID_ROWS

  // Minimum gaps (in grid units; will be converted to mm later)
  const MIN_GAP_STRICT = 1 // at least 1 gutter
  const MIN_GAP_FLEXIBLE = 0.75

  pages.forEach((page) => {
    const elements = Array.isArray(page.elements) ? page.elements : []
    const pageNumber = page.page

    // Check all pairs for overlap/gap
    for (let i = 0; i < elements.length; i += 1) {
      for (let j = i + 1; j < elements.length; j += 1) {
        const a = elements[i]
        const b = elements[j]

        // Check forbidden overlaps
        const aIsImage = a.type === 'image'
        const bIsImage = b.type === 'image'
        const aIsText = a.type === 'text'
        const bIsText = b.type === 'text'

        // Phase 5: Use expanded bounding box collision check (mm coordinates)
        if (useExpandedBbox) {
          const boxA = getExpandedBox(a, 1.5, activeColumns, activeRows)
          const boxB = getExpandedBox(b, 1.5, activeColumns, activeRows)

          if (expandedBoxesOverlap(boxA, boxB)) {
            // Determine minimum required gap
            let requiredGapMm = 0
            let gapType = 'unknown'

            if ((aIsText && bIsImage) || (aIsImage && bIsText)) {
              requiredGapMm = TEXT_IMAGE_MIN_GAP_MM
              gapType = 'text_image'
              issues.push({
                type: 'expanded_bbox_overlap_text_image',
                page: pageNumber,
                element_a: a.id,
                element_b: b.id,
                severity: 'error',
                required_gap_mm: requiredGapMm,
                reason: `Expanded bounding boxes overlap (text-image require ${requiredGapMm}mm gap).`,
              })
            } else if (aIsText && bIsText) {
              requiredGapMm = TEXT_TEXT_MIN_GAP_MM
              gapType = 'text_text'
              issues.push({
                type: 'expanded_bbox_overlap_text_text',
                page: pageNumber,
                element_a: a.id,
                element_b: b.id,
                severity: 'error',
                required_gap_mm: requiredGapMm,
                reason: `Expanded bounding boxes overlap (text-text require ${requiredGapMm}mm gap).`,
              })
            } else if (aIsImage && bIsImage) {
              requiredGapMm = IMAGE_IMAGE_MIN_GAP_MM
              gapType = 'image_image'
              issues.push({
                type: 'expanded_bbox_overlap_image_image',
                page: pageNumber,
                element_a: a.id,
                element_b: b.id,
                severity: 'error',
                required_gap_mm: requiredGapMm,
                reason: `Expanded bounding boxes overlap (image-image require ${requiredGapMm}mm gap).`,
              })
            }
          } else {
            // Check minimum gap (if not overlapping in expanded boxes)
            const gapMm = getGapExpandedBoxes(boxA, boxB)

            if ((aIsText && bIsImage) || (aIsImage && bIsText)) {
              if (gapMm < TEXT_IMAGE_MIN_GAP_MM && gapMm >= 0) {
                issues.push({
                  type: 'insufficient_gap_text_image_mm',
                  page: pageNumber,
                  element_a: a.id,
                  element_b: b.id,
                  severity: 'warning',
                  gap_mm: gapMm,
                  required_gap_mm: TEXT_IMAGE_MIN_GAP_MM,
                  reason: `Text and image gap ${gapMm.toFixed(2)}mm < required ${TEXT_IMAGE_MIN_GAP_MM}mm.`,
                })
              }
            } else if (aIsText && bIsText) {
              if (gapMm < TEXT_TEXT_MIN_GAP_MM && gapMm >= 0) {
                issues.push({
                  type: 'insufficient_gap_text_text_mm',
                  page: pageNumber,
                  element_a: a.id,
                  element_b: b.id,
                  severity: 'warning',
                  gap_mm: gapMm,
                  required_gap_mm: TEXT_TEXT_MIN_GAP_MM,
                  reason: `Text-text gap ${gapMm.toFixed(2)}mm < required ${TEXT_TEXT_MIN_GAP_MM}mm.`,
                })
              }
            } else if (aIsImage && bIsImage) {
              if (gapMm < IMAGE_IMAGE_MIN_GAP_MM && gapMm >= 0) {
                issues.push({
                  type: 'insufficient_gap_image_image_mm',
                  page: pageNumber,
                  element_a: a.id,
                  element_b: b.id,
                  severity: 'warning',
                  gap_mm: gapMm,
                  required_gap_mm: IMAGE_IMAGE_MIN_GAP_MM,
                  reason: `Image-image gap ${gapMm.toFixed(2)}mm < required ${IMAGE_IMAGE_MIN_GAP_MM}mm.`,
                })
              }
            }
          }
        } else {
          // Legacy grid-unit based check
          if (boxesOverlap(a, b)) {
            if ((aIsText && bIsImage) || (aIsImage && bIsText)) {
              issues.push({
                type: 'text_image_overlap',
                page: pageNumber,
                element_a: a.id,
                element_b: b.id,
                severity: 'error',
                reason: 'Text block overlaps image reserved region.',
              })
            }
            if (aIsImage && bIsImage) {
              issues.push({
                type: 'image_image_overlap',
                page: pageNumber,
                element_a: a.id,
                element_b: b.id,
                severity: 'error',
                reason: 'Images overlap (should not happen in modular grid layout).',
              })
            }
            if (aIsText && bIsText) {
              issues.push({
                type: 'text_text_overlap',
                page: pageNumber,
                element_a: a.id,
                element_b: b.id,
                severity: 'error',
                reason: 'Text blocks overlap.',
              })
            }
          } else {
            const gap = getGapGridUnits(a, b)
            const minGap = gridMode === 'strict' ? MIN_GAP_STRICT : MIN_GAP_FLEXIBLE

            if ((aIsText && bIsImage) || (aIsImage && bIsText)) {
              if (gap < minGap && gap >= 0) {
                issues.push({
                  type: 'insufficient_gap_text_image',
                  page: pageNumber,
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
    }
  })

  return {
    passed: issues.filter((i) => i.severity === 'error').length === 0,
    issues,
  }
}
