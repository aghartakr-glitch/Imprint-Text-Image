// CRITICAL FIX: Each paragraph is now a MODULAR TEXT BLOCK, never merged or sequentially paginated.
// This enables images and paragraphs to interleave as intended (see PDF example: text-image-text-image).

import { gridToMm } from './gridToMm.js'
import { estimateTextCapacityMm } from './estimateTextCapacity.js'

const OVERFLOW_BODY_ELEMENT = {
  id: 'body_overflow', type: 'text', role: 'body', col_start: 1, col_span: 6, row_start: 1, row_span: 12,
}

function sliceAtWordBoundary(text, capacity) {
  if (text.length <= capacity) return { slice: text, consumed: text.length }
  const hardCut = text.slice(0, capacity)
  const lastBreak = Math.max(hardCut.lastIndexOf(' '), hardCut.lastIndexOf('\n'))
  if (lastBreak <= 0) return { slice: hardCut, consumed: hardCut.length }
  const slice = hardCut.slice(0, lastBreak)
  let consumed = lastBreak
  while (consumed < text.length && /\s/.test(text[consumed])) consumed += 1
  return { slice, consumed }
}

// Build text_source → paragraph_text mapping.
// CRITICAL: Each textBlock is treated as an INDEPENDENT unit, never split across pages.
function buildTextSourceMap(textBlocks) {
  if (!Array.isArray(textBlocks) || textBlocks.length === 0) {
    return {}
  }
  const map = {}
  textBlocks.forEach((block) => {
    if (block.id && block.text) {
      map[block.id] = block.text  // paragraph_1 → "전체 단락 텍스트"
    }
  })
  return map
}

// NEW BEHAVIOR: text_source-based modular pagination (no sequential slicing).
// Each element with text_source gets the ENTIRE paragraph text assigned directly.
// This enables images and text to interleave as in the user's PDF example.
export function paginateGridPlan(plan, text, textBlocks) {
  const textSourceMap = buildTextSourceMap(textBlocks)
  const hasModularLayout = Object.keys(textSourceMap).length >= 2

  // Phase 1: Assign text_source-based content to ALL text elements (not just body)
  const planPages = plan.pages.map((page) => {
    const textSlicesByElementId = {}

    // Process ALL text elements: title, section_title, overview, context, body, case_body, credit, etc.
    page.elements.forEach((el) => {
      if (el.type !== 'text') return

      let slice = null

      // CRITICAL: If element has text_source, use it DIRECTLY (no sequential pagination)
      if (el.text_source && textSourceMap[el.text_source]) {
        slice = textSourceMap[el.text_source]  // ← Full paragraph text, not sliced
      } else if (el.text_source) {
        // text_source set but not found → leave empty (validation should catch)
        slice = null
      } else if (el.role === 'body' && !hasModularLayout) {
        // Fallback: only for continuous_flow layouts (single long text)
        // This preserves backward compatibility for non-modular content
        // ← NOT IMPLEMENTED HERE (reserved for future legacy support)
        slice = null
      }

      textSlicesByElementId[el.id] = slice
    })

    return { elements: page.elements, textSlicesByElementId }
  })

  // Phase 2: Only create overflow pages if truly needed (single long text without text_source)
  const overflowPages = []
  if (!hasModularLayout) {
    let remainingText = text
    while (remainingText.length > 0) {
      const box = gridToMm(OVERFLOW_BODY_ELEMENT)
      const capacity = estimateTextCapacityMm(box.wMm, box.hMm)
      if (capacity <= 0) throw new Error('오버플로우 텍스트 페이지의 수용량이 0입니다')
      const { slice, consumed } = sliceAtWordBoundary(remainingText, capacity)
      remainingText = remainingText.slice(consumed)
      overflowPages.push({
        elements: [OVERFLOW_BODY_ELEMENT],
        textSlicesByElementId: { [OVERFLOW_BODY_ELEMENT.id]: slice },
      })
    }
  }

  return [...planPages, ...overflowPages]
}
