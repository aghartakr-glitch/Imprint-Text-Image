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
//
// The LLM references paragraphs by ordinal position as "paragraph_N" (enforced by the schema and
// validateLayoutPlan's /^(title|paragraph_\d+)$/ regex), but parseDocumentStructure assigns block
// ids in a different format ("p1", "p2", ...). Registering ONLY block.id here means a valid
// interleaved plan (text_source: "paragraph_1") never matches, so every text element gets a null
// slice and the whole body silently disappears. Fix: alias each block under BOTH its native id
// AND its positional "paragraph_{index+1}" key so either reference resolves to the same paragraph.
function buildTextSourceMap(textBlocks) {
  if (!Array.isArray(textBlocks) || textBlocks.length === 0) {
    return {}
  }
  const map = {}
  textBlocks.forEach((block, index) => {
    if (!block.text) return
    if (block.id) map[block.id] = block.text // native id, e.g. "p1"
    map[`paragraph_${index + 1}`] = block.text // ordinal alias the LLM actually emits
  })
  return map
}

// Break `text` into full-page overflow continuation pages at word boundaries. Shared by both the
// modular (leftover paragraphs) and legacy (single long body) paths so no text is ever dropped.
function buildOverflowPages(text) {
  const pages = []
  let remaining = text
  while (remaining.length > 0) {
    const box = gridToMm(OVERFLOW_BODY_ELEMENT)
    const capacity = estimateTextCapacityMm(box.wMm, box.hMm)
    if (capacity <= 0) throw new Error('오버플로우 텍스트 페이지의 수용량이 0입니다')
    const { slice, consumed } = sliceAtWordBoundary(remaining, capacity)
    remaining = remaining.slice(consumed)
    pages.push({
      elements: [OVERFLOW_BODY_ELEMENT],
      textSlicesByElementId: { [OVERFLOW_BODY_ELEMENT.id]: slice },
    })
  }
  return pages
}

// Two content models, one guarantee: no paragraph is ever silently dropped.
//  - Modular (>=2 text blocks): each element's text_source gets the WHOLE referenced paragraph
//    (no sequential slicing), so images and paragraphs interleave. Any paragraph the plan forgets
//    to reference is appended as overflow continuation pages instead of vanishing.
//  - Legacy/continuous (<2 blocks, or no textBlocks): the plan's body boxes are filled in reading
//    order up to each box's capacity, and the remainder continues onto overflow pages.
export function paginateGridPlan(plan, text, textBlocks) {
  const textSourceMap = buildTextSourceMap(textBlocks)
  const blocks = Array.isArray(textBlocks) ? textBlocks.filter((b) => b.text) : []
  const hasModularLayout = blocks.length >= 2

  if (hasModularLayout) {
    const referencedIndices = new Set()
    const planPages = plan.pages.map((page) => {
      const textSlicesByElementId = {}
      page.elements.forEach((el) => {
        if (el.type !== 'text') return
        let slice = null
        if (el.text_source && textSourceMap[el.text_source]) {
          slice = textSourceMap[el.text_source] // full paragraph, never split
          const m = /^paragraph_(\d+)$/.exec(el.text_source)
          if (m) referencedIndices.add(Number(m[1]) - 1)
          blocks.forEach((b, i) => { if (b.id === el.text_source) referencedIndices.add(i) })
        }
        textSlicesByElementId[el.id] = slice
      })
      return { elements: page.elements, textSlicesByElementId }
    })

    // Safety net: append every paragraph the plan never placed so it still reaches the PDF.
    const leftover = blocks.filter((_, i) => !referencedIndices.has(i)).map((b) => b.text).join('\n\n')
    return [...planPages, ...buildOverflowPages(leftover)]
  }

  // Legacy continuous flow: fill body boxes in order, then overflow the remainder.
  let remaining = text
  const planPages = plan.pages.map((page) => {
    const textSlicesByElementId = {}
    page.elements.forEach((el) => {
      if (el.type !== 'text') return
      if (el.role !== 'body' || remaining.length === 0) {
        textSlicesByElementId[el.id] = null
        return
      }
      const box = gridToMm(el)
      const capacity = estimateTextCapacityMm(box.wMm, box.hMm)
      const { slice, consumed } = sliceAtWordBoundary(remaining, Math.max(1, capacity))
      remaining = remaining.slice(consumed)
      textSlicesByElementId[el.id] = slice
    })
    return { elements: page.elements, textSlicesByElementId }
  })

  return [...planPages, ...buildOverflowPages(remaining)]
}
