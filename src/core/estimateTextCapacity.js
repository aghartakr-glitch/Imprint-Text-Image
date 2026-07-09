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
// 주의: layout.json의 실제 구조는 page.elements가 아니라 page.textBlocks[]를 사용함
export function validateLayoutTextCapacity(plan) {
  const issues = []
  const pages = Array.isArray(plan.pages) ? plan.pages : []

  pages.forEach((pageIdx, page) => {
    // Phase 5: Text blocks 구조 (zone + slice)
    const textBlocks = Array.isArray(page.textBlocks) ? page.textBlocks : []

    textBlocks.forEach((block, blockIdx) => {
      if (block.slice) {
        // zone은 { xMm, yMm, wMm, hMm } 형태
        const zone = block.zone || {}
        const validation = validateTextOverflow(block.slice, { wMm: zone.wMm || 0, hMm: zone.hMm || 0 })
        if (validation.overflow) {
          issues.push({
            elementId: block.id || `text_${pageIdx}_${blockIdx}`,
            page: pageIdx,
            textLength: validation.textLength,
            capacity: validation.capacity,
            ratio: validation.ratio.toFixed(2),
            reason: `텍스트 오버플로우 (길이 ${validation.textLength}ch / 용량 ${validation.capacity}ch, 비율 ${validation.ratio.toFixed(2)}x, 박스 ${zone.wMm}×${zone.hMm}mm)`,
          })
        }
      }
    })
  })

  return issues
}
