import { CHAR_WIDTH_MM, LINE_HEIGHT_MM } from './layoutConstants.js'
import { gridToMm } from './gridToMm.js'

// Never touches font size or leading (body_font_size_pt=9 / body_leading_pt=14 stay fixed) --
// this only estimates how many characters fit, so overflow can be routed to more pages instead.
export function estimateTextCapacityMm(wMm, hMm) {
  const charsPerLine = Math.floor(wMm / CHAR_WIDTH_MM)
  const lines = Math.floor(hMm / LINE_HEIGHT_MM)
  return Math.max(0, charsPerLine * lines)
}

export function estimateTextCapacity(gridElement) {
  const box = gridToMm(gridElement)
  return estimateTextCapacityMm(box.wMm, box.hMm)
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

// Phase 5-2: Validate all text elements in a layout don't overflow
// Returns array of overflow issues
export function validateLayoutTextCapacity(plan) {
  const issues = []
  const pages = Array.isArray(plan.pages) ? plan.pages : []

  pages.forEach((page) => {
    const elements = Array.isArray(page.elements) ? page.elements : []

    elements.forEach((el) => {
      if (el.type === 'text' && el.text) {
        const validation = validateTextOverflow(el.text, el)
        if (validation.overflow) {
          issues.push({
            elementId: el.id,
            page: page.page,
            textLength: validation.textLength,
            capacity: validation.capacity,
            ratio: validation.ratio.toFixed(2),
            reason: `텍스트 오버플로우 (길이 ${validation.textLength}ch / 용량 ${validation.capacity}ch, 비율 ${validation.ratio.toFixed(2)}x)`,
          })
        }
      }
    })
  })

  return issues
}
