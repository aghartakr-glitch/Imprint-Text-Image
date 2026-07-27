import {
  PT_TO_MM, ROLE_FONT_SIZE_PT, ROLE_LEADING_PT, ROLE_BOLD_WIDTH_FACTOR, CHAR_WIDTH_CALIBRATION_FACTOR,
} from './layoutConstants.js'
import { gridToMm } from './gridToMm.js'

// Capacity depends on which font the role actually renders in (see buildLatex.js's
// styleCommandForRole) -- a 'title' element renders at 28pt/34pt via \TitleText, not the 9pt/14pt
// body font, so estimating its capacity with body metrics computes a box far too small for even
// one line (confirmed 2026-07-16: a "Macro-trend" title box was sized for ~2 lines of 9pt text,
// but \TitleText's single line alone needs more height than that, so it overflowed down into the
// element below it). Defaults to 'body' so every existing caller that doesn't pass a role keeps
// its previous behavior unchanged.
export function estimateTextCapacityMm(wMm, hMm, role = 'body') {
  const fontSizePt = ROLE_FONT_SIZE_PT[role] ?? ROLE_FONT_SIZE_PT.body
  const leadingPt = ROLE_LEADING_PT[role] ?? ROLE_LEADING_PT.body
  const boldFactor = ROLE_BOLD_WIDTH_FACTOR[role] ?? 1
  const charWidthMm = fontSizePt * PT_TO_MM * boldFactor * CHAR_WIDTH_CALIBRATION_FACTOR
  const lineHeightMm = leadingPt * PT_TO_MM

  const charsPerLine = Math.floor(wMm / charWidthMm)
  const lines = Math.floor(hMm / lineHeightMm)
  return Math.max(0, charsPerLine * lines)
}

export function estimateTextCapacity(gridElement) {
  const box = gridToMm(gridElement)
  return estimateTextCapacityMm(box.wMm, box.hMm, gridElement?.role)
}

// Phase 5-2: Validate if text overflows given box dimensions
// Returns: { overflow: boolean, capacity: number, textLength: number, ratio: number }
export function validateTextOverflow(textContent, gridElement) {
  if (!textContent || !gridElement) {
    return { overflow: false, capacity: 0, textLength: 0, ratio: 0 }
  }

  const capacity = estimateTextCapacity(gridElement)
  const textLength = (textContent || '').length

  // Text overflows if length exceeds capacity by more than 5% (small margin for formatting)
  const ratio = textLength / Math.max(1, capacity)
  const overflow = ratio > 1.05

  return { overflow, capacity, textLength, ratio }
}

// Builds a text_source -> char_count lookup ("paragraph_N" alias, mirroring the same aliasing
// paginateGridPlan.js's buildTextSourceMap uses) so overflow can be checked against a plan's raw
// grid-unit elements (col_start/col_span/row_start/row_span + text_source) BEFORE the plan is ever
// reconstructed into mm zones/slices.
function buildCharCountMap(textBlocks) {
  const map = {}
  if (!Array.isArray(textBlocks)) return map
  textBlocks.forEach((block, index) => {
    const charCount = Number.isFinite(block.char_count) ? block.char_count : (block.text ? block.text.length : null)
    if (charCount == null) return
    if (block.id) map[block.id] = charCount
    map[`paragraph_${index + 1}`] = charCount
  })
  return map
}

// Phase 5-2: Validate all text elements in a layout don't overflow their declared grid box.
// Runs on the RAW candidate (col_start/col_span/row_start/row_span + text_source), the same shape
// validateLayoutPlan validates everything else against -- checking after-the-fact against the
// resolved mm layout.json (page.textBlocks[].zone/slice) is too late, since reconstructLayout has
// already committed to those exact boxes by then and PDF rendering will overflow them silently
// (confirmed 2026-07-09: a paragraph_source element's full, unsliced text routinely exceeds its
// box and visually bleeds into whatever image or text sits below it).
export function validateLayoutTextCapacity(plan, textBlocks = []) {
  const issues = []
  const pages = Array.isArray(plan.pages) ? plan.pages : []
  const gridSpec = plan.grid_spec || plan.grid
  const gridOptions = gridSpec?.columns && gridSpec?.rows
    ? { columns: gridSpec.columns, rows: gridSpec.rows, gutterMm: gridSpec.gutter_mm }
    : undefined
  const charCountMap = buildCharCountMap(textBlocks)

  pages.forEach((page) => {
    const elements = Array.isArray(page.elements) ? page.elements : []
    elements.forEach((el) => {
      if (el.type !== 'text') return

      let textLength = null
      if (el.text_source && charCountMap[el.text_source] != null) {
        textLength = charCountMap[el.text_source]
      } else if (typeof el.text === 'string') {
        textLength = el.text.length
      }
      if (textLength == null) return

      // Note: validateTextOverflow (and estimateTextCapacity) expect a raw grid-unit element and
      // run it through gridToMm themselves -- `box` here is already in mm, so capacity must be
      // computed directly via estimateTextCapacityMm rather than passing `box` back through
      // validateTextOverflow (which would re-run gridToMm on {wMm, hMm}, treating them as a
      // nonexistent col_start/row_start and silently producing NaN).
      const box = gridToMm(el, gridOptions)
      const capacity = estimateTextCapacityMm(box.wMm, box.hMm, el.role)
      const ratio = textLength / Math.max(1, capacity)
      if (ratio > 1.05) {
        issues.push({
          elementId: el.id,
          page: page.page,
          textLength,
          capacity,
          ratio: ratio.toFixed(2),
          reason: `텍스트 오버플로우 (길이 ${textLength}ch / 용량 ${capacity}ch, 비율 ${ratio.toFixed(2)}x, 박스 ${box.wMm.toFixed(1)}×${box.hMm.toFixed(1)}mm)`,
        })
      }
    })
  })

  return issues
}
