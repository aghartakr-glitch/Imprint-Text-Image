import { gridToMm } from './gridToMm.js'
import { estimateTextCapacityMm } from './estimateTextCapacity.js'

// A full-page text-only box used for continuation pages once body text overflows every body box
// the plan itself defined. Matches overflow_policy.body_overflow: continue_to_next_page.
const OVERFLOW_BODY_ELEMENT = {
  id: 'body_overflow', type: 'text', role: 'body', col_start: 1, col_span: 6, row_start: 1, row_span: 12,
}

// A raw slice(0, capacity) cuts mid-word (e.g. "Shorts" -> "Sho" on one page, "rts" on the next).
// Back up to the nearest preceding whitespace/newline so a slice always ends on a word boundary.
// Falls back to the hard cut only when a single "word" is itself longer than the whole capacity
// (rare, and there is no better option at that point).
function sliceAtWordBoundary(text, capacity) {
  if (text.length <= capacity) return { slice: text, consumed: text.length }
  const hardCut = text.slice(0, capacity)
  const lastBreak = Math.max(hardCut.lastIndexOf(' '), hardCut.lastIndexOf('\n'))
  if (lastBreak <= 0) return { slice: hardCut, consumed: hardCut.length }
  const slice = hardCut.slice(0, lastBreak)
  // Also consume the whitespace itself plus any that immediately follows, so the next page
  // doesn't start with a leading space.
  let consumed = lastBreak
  while (consumed < text.length && /\s/.test(text[consumed])) consumed += 1
  return { slice, consumed }
}

// Build a map from text_source ID to full text for LLM-generated layouts.
// If textBlocks is provided and has multiple blocks (indicating modular layout),
// use text_source to reference specific paragraphs. Otherwise fall back to merging all text.
function buildTextSourceMap(textBlocks) {
  if (!Array.isArray(textBlocks) || textBlocks.length === 0) {
    return {}
  }
  const map = {}
  textBlocks.forEach((block) => {
    if (block.id && block.text) {
      map[block.id] = block.text
    }
  })
  return map
}

// Distributes the full body text across the plan's own body-role text boxes (one per page, in
// page order), then appends as many full-page continuation pages as needed for whatever text
// doesn't fit -- deterministic pagination, never shrinking font size or leading. Returns an array
// of { elements, textSlicesByElementId } ready for resolveGridPage.
// If textBlocks is provided and has multiple blocks, uses text_source to assign specific paragraphs.
export function paginateGridPlan(plan, text, textBlocks) {
  const textSourceMap = buildTextSourceMap(textBlocks)
  const hasMultipleBlocks = Object.keys(textSourceMap).length > 1
  let remainingText = text

  const planPages = plan.pages.map((page) => {
    const textSlicesByElementId = {}

    // Process ALL text elements on the page (not just the first body element)
    // to support column-flow layouts with multiple text slots per page.
    page.elements.forEach((el) => {
      if (el.type !== 'text' || el.role !== 'body') return

      let slice = null

      // If LLM set text_source and we have corresponding textBlock, use it
      if (hasMultipleBlocks && el.text_source && textSourceMap[el.text_source]) {
        slice = textSourceMap[el.text_source]
      } else if (hasMultipleBlocks && el.text_source) {
        // text_source was set but block not found — LLM may have referenced non-existent paragraph
        // Fall through to empty slice (validation should catch this)
        slice = null
      } else {
        // No text_source or single-block layout — use sequential pagination from remainingText
        const box = gridToMm(el)
        const capacity = estimateTextCapacityMm(box.wMm, box.hMm)
        if (capacity > 0 && remainingText.length > 0) {
          const result = sliceAtWordBoundary(remainingText, capacity)
          slice = result.slice
          remainingText = remainingText.slice(result.consumed)
        }
      }

      textSlicesByElementId[el.id] = slice
    })

    return { elements: page.elements, textSlicesByElementId }
  })

  // Append overflow pages only for sequential mode (when no text_source was used)
  // In modular mode, overflow pages should be handled by the plan or fallback
  const overflowPages = []
  if (!hasMultipleBlocks) {
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
